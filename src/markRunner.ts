import * as cp from 'child_process';
import { readFile } from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkResult } from './types';
import { parseMarkMetadata } from './markParser';
import { getConfig } from './utils';
import { getApiToken, redactSecrets } from './credentials';

/**
 * Output channel for mark CLI logs.
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('VcMd2Conf — mark');
  }
  return outputChannel;
}

function getFeaturesArgument(configuredFeatures: string | undefined): string {
  const features = new Set((configuredFeatures || '').split(',').map((feature) => feature.trim()).filter(Boolean));
  features.add('frontmatter');
  return `--features=${Array.from(features).join(',')}`;
}

async function hasExplicitSpace(filePath: string): Promise<boolean> {
  try {
    return Boolean(parseMarkMetadata(await readFile(filePath, 'utf8'))?.space);
  } catch {
    return false;
  }
}

/**
 * Build the mark CLI command arguments for publishing a file.
 */
async function buildPublishArgs(filePath: string): Promise<string[]> {
  const config = getConfig();
  const args: string[] = [];

  // Config file
  const configPath = config.get<string>('markConfigPath');
  if (configPath) {
    args.push('-c', configPath);
  }

  // Credentials (only if no config file)
  if (!configPath) {
    const baseUrl = config.get<string>('baseUrl');
    const username = config.get<string>('username');
    const apiToken = getApiToken();

    if (baseUrl) {
      args.push('-b', baseUrl);
    }
    if (username) {
      args.push('-u', username);
    }
    if (apiToken) {
      args.push('-p', '-');
    }
  }

  // Publish subcommand
  args.push('publish', '--title-from-h1');

  const space = config.get<string>('defaultSpace');
  if (space && !(await hasExplicitSpace(filePath))) {
    args.push('--space', space);
  }

  args.push(getFeaturesArgument(config.get<string>('markFeatures')));

  // File target
  args.push('-f', filePath);

  return args;
}

/**
 * Execute mark CLI to sync a single file to Confluence.
 *
 * @param filePath Absolute path to the Markdown file
 * @returns Result of the mark execution
 */
export async function syncFile(filePath: string): Promise<MarkResult> {
  const config = getConfig();
  const markPath = config.get<string>('markPath') || 'mark';
  const args = await buildPublishArgs(filePath);
  const channel = getOutputChannel();

  const cmdLine = redactSecrets(`${markPath} ${args.join(' ')}`);
  channel.appendLine(`\n${'─'.repeat(60)}`);
  channel.appendLine(`🚀 Syncing: ${path.basename(filePath)}`);
  channel.appendLine(`   Command: ${cmdLine}`);
  channel.appendLine(`   Time: ${new Date().toLocaleTimeString()}`);
  channel.appendLine(`${'─'.repeat(60)}`);

  return new Promise<MarkResult>((resolve) => {
    const workDir = path.dirname(filePath);

    const proc = cp.spawn(markPath, args, {
      cwd: workDir,
      shell: false,
      env: { ...process.env },
    });
    proc.stdin?.on('error', () => {});
    proc.stdin?.end(config.get<string>('markConfigPath') ? undefined : `${getApiToken()}\n`);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
    });

    proc.on('error', (err) => {
      const errorMsg = redactSecrets(`Failed to execute mark: ${err.message}`);
      channel.appendLine(`\n❌ ${errorMsg}`);
      resolve({
        success: false,
        stdout: redactSecrets(stdout),
        stderr: errorMsg,
        exitCode: -1,
      });
    });

    proc.on('close', (code) => {
      const exitCode = code ?? -1;
      const success = exitCode === 0;
      channel.append(redactSecrets(stdout + stderr));

      if (success) {
        channel.appendLine(`\n✅ Sync successful`);
      } else {
        channel.appendLine(`\n❌ Sync failed (exit code: ${exitCode})`);
      }

      // Try to extract page URL from mark output
      const pageUrl = extractPageUrl(stdout + stderr);
      const pageId = extractPageId(stdout + stderr);

      resolve({
        success,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        exitCode,
        pageUrl,
        pageId,
      });
    });
  });
}

/**
 * Execute mark CLI to sync all Markdown files in a folder.
 */
export async function syncFolder(folderPath: string): Promise<MarkResult> {
  const config = getConfig();
  const markPath = config.get<string>('markPath') || 'mark';
  const channel = getOutputChannel();

  const args: string[] = [];

  const configPath = config.get<string>('markConfigPath');
  if (configPath) {
    args.push('-c', configPath);
  } else {
    const baseUrl = config.get<string>('baseUrl');
    const username = config.get<string>('username');
    const apiToken = getApiToken();
    if (baseUrl) { args.push('-b', baseUrl); }
    if (username) { args.push('-u', username); }
    if (apiToken) { args.push('-p', '-'); }
  }

  args.push('publish', '--title-from-h1');

  const space = config.get<string>('defaultSpace');
  if (space) { args.push('--space', space); }

  args.push(getFeaturesArgument(config.get<string>('markFeatures')));

  // Use glob pattern for all md files in folder
  args.push('-f', path.join(folderPath, '**/*.md'));

  channel.appendLine(`\n${'─'.repeat(60)}`);
  channel.appendLine(`🚀 Syncing folder: ${folderPath}`);
  channel.appendLine(`   Command: ${redactSecrets(`${markPath} ${args.join(' ')}`)}`);
  channel.appendLine(`${'─'.repeat(60)}`);

  return new Promise<MarkResult>((resolve) => {
    const proc = cp.spawn(markPath, args, {
      cwd: folderPath,
      shell: false,
      env: { ...process.env },
    });
    proc.stdin?.on('error', () => {});
    proc.stdin?.end(configPath ? undefined : `${getApiToken()}\n`);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
    });

    proc.on('error', (err) => {
      const message = redactSecrets(`Failed to execute mark: ${err.message}`);
      channel.appendLine(message);
      resolve({
        success: false,
        stdout: redactSecrets(stdout),
        stderr: message,
        exitCode: -1,
      });
    });

    proc.on('close', (code) => {
      const exitCode = code ?? -1;
      channel.append(redactSecrets(stdout + stderr));
      channel.appendLine(`\nExit code: ${exitCode}`);
      resolve({
        success: exitCode === 0,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        exitCode,
        pageUrl: extractPageUrl(stdout + stderr),
        pageId: extractPageId(stdout + stderr),
      });
    });
  });
}

/**
 * Check if mark CLI is available and accessible.
 */
export async function checkMarkAvailable(): Promise<boolean> {
  return (await inspectMark()).success;
}

export function inspectMark(markPath = getConfig().get<string>('markPath') || 'mark'): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    cp.execFile(markPath, ['--version'], { timeout: 10000, maxBuffer: 128 * 1024 }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        message: redactSecrets(error
          ? `Executable : ${markPath}\n${error.message}\n${stderr}\nVerifiez le chemin, les droits d execution ou installez mark.`
          : `Executable : ${markPath}\n${stdout.trim() || stderr.trim() || 'mark disponible.'}`),
      });
    });
  });
}

export function showMarkOutput(): void {
  getOutputChannel().show(true);
}

export function describeMarkError(result: MarkResult): string {
  const details = redactSecrets((result.stderr || result.stdout || 'Aucun detail fourni par mark.').trim());
  let advice = 'Consultez les logs et verifiez les metadonnees Space/Title du document.';
  if (/ENOENT|not found|not recognized/i.test(details)) {
    advice = 'mark est introuvable. Installez-le ou selectionnez son executable dans la configuration.';
  } else if (/401|unauthorized|authentication/i.test(details)) {
    advice = 'Verifiez le PAT. Pour Cloud, indiquez aussi votre email ; pour Server/DC avec PAT, laissez l utilisateur vide.';
  } else if (/403|forbidden|permission denied/i.test(details)) {
    advice = 'Verifiez les droits sur l espace Confluence et les permissions de publication.';
  } else if (/certificate|x509|tls/i.test(details)) {
    advice = 'Verifiez le certificat TLS et les certificats de votre entreprise. Ne desactivez pas la verification TLS.';
  } else if (/timeout|ENOTFOUND|ECONNREFUSED|network/i.test(details)) {
    advice = 'Verifiez l URL Confluence, le reseau, le VPN et le proxy.';
  } else if (/mermaid|chrome|chromium|browser/i.test(details)) {
    advice = 'Verifiez les fonctionnalites Mermaid de mark et la presence du moteur de rendu requis (Chrome/Chromium par defaut).';
  } else if (/unknown command|flag provided but not defined|unknown flag/i.test(details)) {
    advice = 'Cette extension utilise mark v17 (commande publish). Verifiez la version et les options configurees.';
  }
  return `Code de sortie : ${result.exitCode}\n${details.substring(0, 4000)}\n\n${advice}`;
}

/**
 * Try to extract a Confluence page URL from mark's output.
 */
function extractPageUrl(output: string): string | undefined {
  // mark typically outputs the URL of the created/updated page
  const urlMatch = output.match(/https?:\/\/[^\s]+\/wiki\/[^\s]+/i);
  if (urlMatch) {
    return urlMatch[0];
  }

  // Also try pages pattern
  const pagesMatch = output.match(/https?:\/\/[^\s]+\/pages\/[^\s]+/i);
  if (pagesMatch) {
    return pagesMatch[0];
  }

  return undefined;
}

/**
 * Try to extract a Confluence page ID from mark's output.
 */
function extractPageId(output: string): string | undefined {
  const idMatch = output.match(/page\s+id[:\s]+(\d+)/i);
  if (idMatch) {
    return idMatch[1];
  }
  // Also try URL-based extraction: /pages/12345/
  const urlIdMatch = output.match(/\/pages\/(\d+)/);
  if (urlIdMatch) {
    return urlIdMatch[1];
  }
  return undefined;
}

/**
 * Dispose the output channel.
 */
export function disposeOutputChannel(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
