import * as cp from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { inspectMark } from './markRunner';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export function selectMarkAsset(assets: ReleaseAsset[], platform: string = process.platform, architecture: string = process.arch): ReleaseAsset {
  const systems: Record<string, string> = { win32: 'windows', darwin: 'darwin', linux: 'linux' };
  const architectures: Record<string, string[]> = {
    x64: ['amd64', 'x86_64'], arm64: ['arm64', 'aarch64'], ia32: ['386', 'i386'],
  };
  const system = systems[platform];
  const candidates = architectures[architecture];
  const asset = system && candidates && assets.find((entry) => {
    const name = entry.name.toLowerCase();
    return name.includes(`_${system}_`)
      && candidates.some((candidate) => name.includes(`_${candidate}.`))
      && /\.(zip|tar\.gz)$/.test(name);
  });
  if (!asset) {
    throw new Error(`Aucun binaire officiel mark pour ${platform}/${architecture}. Consultez les releases GitHub.`);
  }
  return asset;
}

async function download(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['api.github.com', 'github.com'].includes(parsed.hostname)) {
    throw new Error('Source de telechargement non autorisee.');
  }
  const response = await fetch(url, {
    headers: { 'User-Agent': 'VcMd2Conf', 'Accept': 'application/octet-stream' },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    throw new Error(`GitHub HTTP ${response.status}. Verifiez le reseau, le proxy ou la limite API GitHub.`);
  }
  if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) {
    throw new Error('Archive trop volumineuse (limite : 100 Mo).');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 100 * 1024 * 1024) {
    throw new Error('Archive trop volumineuse (limite : 100 Mo).');
  }
  return buffer;
}

export async function installMark(context: vscode.ExtensionContext): Promise<string | undefined> {
  if (!vscode.workspace.isTrusted) {
    throw new Error('Ouvrez un espace de travail approuve avant d installer un executable.');
  }
  const choice = await vscode.window.showWarningMessage(
    `Telecharger et executer mark depuis les releases officielles GitHub (kovetskiy/mark) pour ${process.platform}/${process.arch} ? Installation privee a l extension, sans droits administrateur.`,
    { modal: true },
    'Installer',
  );
  if (choice !== 'Installer') { return undefined; }

  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Installation de mark',
    cancellable: false,
  }, async (progress) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'vcmd2conf-mark-'));
    try {
      progress.report({ message: 'Recherche du binaire officiel...' });
      const release = JSON.parse((await download('https://api.github.com/repos/kovetskiy/mark/releases/latest')).toString('utf8')) as {
        tag_name: string; assets: ReleaseAsset[];
      };
      if (!/^v17\.\d+\.\d+$/.test(release.tag_name)) {
        throw new Error(`Version ${release.tag_name} non prise en charge. Cette extension attend mark v17.`);
      }
      const executable = process.platform === 'win32' ? 'mark.exe' : 'mark';
      let asset: ReleaseAsset | undefined;
      try {
        asset = selectMarkAsset(release.assets);
      } catch (error) {
        if (process.platform !== 'win32') { throw error; }
      }
      if (!asset) {
        progress.report({ message: 'Compilation Windows avec Go (peut prendre plusieurs minutes)...' });
        await new Promise<void>((resolve, reject) => {
          cp.execFile('go', ['install', `github.com/kovetskiy/mark/v17/cmd/mark@${release.tag_name}`], {
            cwd: temporary,
            env: { ...process.env, GOBIN: temporary, GOWORK: 'off' },
            timeout: 600000,
            maxBuffer: 2 * 1024 * 1024,
          }, (error, _stdout, stderr) => {
            if (error) {
              reject(new Error(`Installation Windows via Go impossible : ${error.message}\n${stderr}\nInstallez Go depuis https://go.dev/dl/, puis relancez VS Code. Aucun binaire Windows officiel n est disponible dans cette release.`));
            } else { resolve(); }
          });
        });
      } else {
        const checksumAsset = release.assets.find((entry) => /checksums.*\.txt$|sha256sums/i.test(entry.name));
        if (!checksumAsset) {
          throw new Error('La release ne fournit pas de sommes SHA-256. Installation annulee.');
        }
        progress.report({ message: `Telechargement ${release.tag_name} : ${asset.name}` });
        const archive = await download(asset.browser_download_url);
        const checksums = (await download(checksumAsset.browser_download_url)).toString('utf8');
        const expected = checksums.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
          .find((parts) => parts[1]?.replace(/^\*/, '') === asset.name)?.[0];
        const actual = createHash('sha256').update(archive).digest('hex');
        if (!expected || expected.toLowerCase() !== actual) {
          throw new Error('Verification SHA-256 echouee. Le binaire ne sera pas installe.');
        }
        const archivePath = path.join(temporary, asset.name);
        await fs.writeFile(archivePath, archive);
        progress.report({ message: 'Extraction et verification...' });
        await new Promise<void>((resolve, reject) => {
          cp.execFile('tar', ['-xf', archivePath, '-C', temporary, executable], { timeout: 30000 }, (error) => {
            if (error) {
              reject(new Error(`Extraction impossible : ${error.message}. Verifiez que tar est disponible (inclus avec Windows recent).`));
            } else { resolve(); }
          });
        });
      }
      const extracted = path.join(temporary, executable);
      if (!(await fs.lstat(extracted)).isFile()) {
        throw new Error('Le fichier extrait n est pas un executable regulier.');
      }
      if (process.platform !== 'win32') { await fs.chmod(extracted, 0o755); }
      const inspection = await inspectMark(extracted);
      if (!inspection.success) { throw new Error(inspection.message); }
      const directory = path.join(context.globalStorageUri.fsPath, 'bin');
      await fs.mkdir(directory, { recursive: true });
      const destination = path.join(directory, executable);
      await fs.copyFile(extracted, destination);
      if (process.platform !== 'win32') { await fs.chmod(destination, 0o755); }
      return destination;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
}