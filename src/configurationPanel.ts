import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { ConfluenceApi } from './confluenceApi';
import { getApiToken, redactSecrets, saveApiToken } from './credentials';
import { installMark } from './markInstaller';
import { inspectMark, showMarkOutput } from './markRunner';
import { getConfig } from './utils';

let currentPanel: vscode.WebviewPanel | undefined;

export function openConfiguration(context: vscode.ExtensionContext, api: ConfluenceApi): void {
  if (currentPanel) { currentPanel.reveal(); return; }
  const panel = vscode.window.createWebviewPanel('vcmd2conf.configuration', 'VcMd2Conf - Configuration', vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [],
  });
  currentPanel = panel;
  const config = getConfig();
  const nonce = randomBytes(18).toString('hex');
  const escape = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
  const value = (key: string, fallback = ''): string => escape(config.get<string>(key) || fallback);
  const storedToken = !!getApiToken();
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : process.platform;
  panel.webview.html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Configuration VcMd2Conf</title>
<style nonce="${nonce}">
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; }
main { max-width: 760px; padding: 28px 24px 48px; margin: auto; }
header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 18px; }
h1 { font-size: 24px; margin: 0 0 6px; font-weight: 600; }
h2 { font-size: 17px; margin: 0 0 20px; font-weight: 600; }
p { line-height: 1.5; margin: 6px 0; }
section { padding: 24px 0; border-bottom: 1px solid var(--vscode-panel-border); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
.wide { grid-column: 1 / -1; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.options { margin-top: 20px; }
label { display: block; margin-bottom: 7px; }
input { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); border-radius: 2px; font: inherit; min-width: 0; }
input:focus, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
button { font: inherit; padding: 8px 12px; cursor: pointer; border: 1px solid transparent; border-radius: 2px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); white-space: normal; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: .6; cursor: wait; }
.muted { color: var(--vscode-descriptionForeground); font-size: 12px; overflow-wrap: anywhere; }
.path { display: flex; gap: 8px; align-items: end; }
.path input { flex: 1; }
.path button { flex-shrink: 0; }
.check { display: flex; gap: 8px; align-items: center; margin: 12px 0 0; }
.check input { width: auto; }
#result { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; margin: 18px 0; padding: 12px; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-textCodeBlock-background); }
#result.error { border-color: var(--vscode-errorForeground); }
#result.success { border-color: var(--vscode-testing-iconPassed); }
@media (max-width: 560px) { main { padding: 20px 14px; } .grid { grid-template-columns: minmax(0, 1fr); } .path { flex-wrap: wrap; } .path input { flex-basis: 100%; } }
</style></head><body><main>
<header><h1>VcMd2Conf</h1><p>Configuration Confluence</p></header>
<form id="configuration">
<fieldset id="fields">
<section aria-labelledby="connection"><h2 id="connection">Connexion</h2><div class="grid">
<div class="wide"><label for="baseUrl">URL Confluence</label><input id="baseUrl" name="baseUrl" type="url" required value="${value('baseUrl')}" placeholder="https://votre-instance.atlassian.net/wiki"></div>
<div><label for="username">Utilisateur / email (Cloud)</label><input id="username" name="username" value="${value('username')}" autocomplete="username"><p class="muted">Vide pour un PAT Confluence Server / Data Center.</p></div>
<div><label for="apiToken">PAT / jeton API</label><input id="apiToken" name="apiToken" type="password" autocomplete="off" placeholder="${storedToken ? 'Jeton conserve ; saisir pour remplacer' : 'Saisir le jeton'}"><p id="tokenState" class="muted">${storedToken ? 'Un jeton est configure.' : 'Aucun jeton configure.'}</p></div>
<div><label for="defaultSpace">Espace par defaut</label><input id="defaultSpace" name="defaultSpace" value="${value('defaultSpace')}" placeholder="DOCS"></div>
</div><label class="check"><input type="checkbox" id="removeToken">Supprimer le jeton enregistre</label></section>
<section aria-labelledby="mark"><h2 id="mark">mark CLI</h2>
<label for="markPath">Emplacement de l executable</label><div class="path"><input id="markPath" name="markPath" required value="${value('markPath', 'mark')}"><button type="button" data-action="browse">Parcourir...</button></div>
<div class="actions"><button type="button" data-action="checkMark">Verifier mark</button><button type="button" data-action="install">Installer pour ${escape(platform)}</button></div>
${process.platform === 'win32' ? '<p class="muted">Si aucun binaire Windows officiel n est disponible, Go doit etre installe pour compiler mark.</p>' : ''}
<div class="grid options"><div><label for="markFeatures">Fonctionnalites</label><input id="markFeatures" name="markFeatures" value="${value('markFeatures')}" placeholder="mermaid,frontmatter"></div>
<div><label for="markConfigPath">Fichier de configuration mark (optionnel)</label><input id="markConfigPath" name="markConfigPath" value="${value('markConfigPath')}"></div></div>
<p class="muted">Un fichier de configuration mark renseigne prend la priorite pour l authentification CLI. Le test de connexion utilise les champs ci-dessus.</p>
</section><div class="actions"><button class="primary" type="submit">Enregistrer</button><button type="button" data-action="test">Enregistrer et tester</button></div>
</fieldset></form>
<div id="result" role="status" aria-live="polite" hidden></div>
<div class="actions"><button type="button" id="logs">Ouvrir les logs</button><button type="button" id="releases">Releases officielles</button></div>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const form = document.getElementById('configuration');
const fields = document.getElementById('fields');
const result = document.getElementById('result');
const keys = ['baseUrl', 'username', 'apiToken', 'defaultSpace', 'markPath', 'markFeatures', 'markConfigPath'];
function send(action) {
  if ((action === 'save' || action === 'test') && !form.reportValidity()) return;
  const values = Object.fromEntries(keys.map(key => [key, document.getElementById(key).value]));
  values.removeToken = document.getElementById('removeToken').checked;
  fields.disabled = true;
  result.hidden = false;
  result.className = '';
  result.textContent = 'Operation en cours...';
  vscode.postMessage({ action, values });
}
form.addEventListener('submit', event => { event.preventDefault(); send('save'); });
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => send(button.dataset.action)));
document.getElementById('logs').addEventListener('click', () => vscode.postMessage({ action: 'logs' }));
document.getElementById('releases').addEventListener('click', () => vscode.postMessage({ action: 'releases' }));
window.addEventListener('message', event => {
  const message = event.data;
  fields.disabled = false;
  result.hidden = false;
  result.textContent = message.message;
  result.className = message.success ? 'success' : 'error';
  if (message.markPath) document.getElementById('markPath').value = message.markPath;
  if (message.saved) {
    document.getElementById('apiToken').value = '';
    document.getElementById('removeToken').checked = false;
    document.getElementById('apiToken').placeholder = message.hasToken ? 'Jeton conserve ; saisir pour remplacer' : 'Saisir le jeton';
    document.getElementById('tokenState').textContent = message.hasToken ? 'Jeton enregistre dans le stockage securise VS Code.' : 'Aucun jeton configure.';
  }
});
</script></body></html>`;

  let busy = false;
  const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!message || typeof message !== 'object') { return; }
    const { action, values } = message as { action?: string; values?: Record<string, unknown> };
    if (action === 'logs') { showMarkOutput(); return; }
    if (action === 'releases') {
      await vscode.env.openExternal(vscode.Uri.parse('https://github.com/kovetskiy/mark/releases'));
      return;
    }
    if (busy) { return; }
    busy = true;
    let saved = false;
    try {
      if (!vscode.workspace.isTrusted) {
        throw new Error('Approuvez cet espace de travail avant de configurer ou executer mark.');
      }
      const text = (key: string): string => typeof values?.[key] === 'string' ? values[key] as string : '';
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      let success = true;
      let response = '';
      let markPath: string | undefined;
      if (action === 'browse') {
        const files = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, title: 'Selectionner mark' });
        markPath = files?.[0]?.fsPath;
        response = markPath ? 'Executable selectionne. Enregistrez pour appliquer.' : 'Selection annulee.';
      } else if (action === 'install') {
        markPath = await installMark(context);
        if (markPath) { await getConfig().update('markPath', markPath, target); }
        response = markPath ? `mark installe et configure : ${markPath}` : 'Installation annulee.';
      } else if (action === 'checkMark') {
        const inspection = await inspectMark(text('markPath').trim() || 'mark');
        success = inspection.success;
        response = inspection.message;
      } else if (action === 'save' || action === 'test') {
        const baseUrl = text('baseUrl').trim().replace(/\/+$/, '');
        const url = new URL(baseUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
          throw new Error('Utilisez une URL HTTP(S) sans identifiants, parametres ni fragment.');
        }
        if (url.protocol === 'http:') {
          const confirm = await vscode.window.showWarningMessage('HTTP transmet le PAT sans chiffrement. Continuer ?', { modal: true }, 'Continuer');
          if (confirm !== 'Continuer') { throw new Error('Enregistrement annule. Utilisez HTTPS pour proteger le PAT.'); }
        }
        const newToken = text('apiToken');
        if (/[\r\n]/.test(newToken)) { throw new Error('Le PAT ne doit pas contenir de retour a la ligne.'); }
        if (values?.removeToken === true && newToken) { throw new Error('Choisissez de remplacer ou de supprimer le PAT, pas les deux.'); }
        if (!text('markPath').trim()) { throw new Error('Indiquez le chemin de mark ou la commande mark.'); }
        for (const [key, entry] of Object.entries({
          baseUrl, username: text('username').trim(), defaultSpace: text('defaultSpace').trim(),
          markPath: text('markPath').trim(), markFeatures: text('markFeatures').trim(), markConfigPath: text('markConfigPath').trim(),
        })) {
          await getConfig().update(key, entry, target);
        }
        if (newToken || values?.removeToken === true || getApiToken()) {
          await saveApiToken(values?.removeToken === true ? '' : newToken || getApiToken());
        }
        api.refreshConfig();
        saved = true;
        response = 'Configuration enregistree.';
        if (action === 'test') {
          const connection = await api.testConnection();
          success = connection.success;
          response = connection.message;
        }
      } else { return; }
      await panel.webview.postMessage({ success, message: redactSecrets(response), markPath, saved, hasToken: !!getApiToken() });
    } catch (error) {
      await panel.webview.postMessage({
        success: false,
        message: redactSecrets(error instanceof Error ? error.message : String(error)),
        saved, hasToken: !!getApiToken(),
      });
    } finally { busy = false; }
  });
  panel.onDidDispose(() => { currentPanel = undefined; messages.dispose(); });
  context.subscriptions.push(panel);
}