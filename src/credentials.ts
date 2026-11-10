import * as vscode from 'vscode';
import { getConfig } from './utils';

let secrets: vscode.SecretStorage;
let token = '';

export async function initializeCredentials(storage: vscode.SecretStorage): Promise<void> {
  secrets = storage;
  token = await secrets.get('vcmd2conf.apiToken') || '';
}

export function getApiToken(): string {
  return token || getConfig().get<string>('apiToken') || '';
}

export async function saveApiToken(value: string): Promise<void> {
  await secrets.store('vcmd2conf.apiToken', value);
  token = value;
  const config = getConfig();
  const previous = config.inspect<string>('apiToken');
  if (previous?.globalValue !== undefined) {
    await config.update('apiToken', undefined, vscode.ConfigurationTarget.Global);
  }
  if (previous?.workspaceValue !== undefined) {
    await config.update('apiToken', undefined, vscode.ConfigurationTarget.Workspace);
  }
  if (previous?.workspaceFolderValue !== undefined) {
    await config.update('apiToken', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
  }
}

export function redactSecrets(value: string): string {
  const secret = getApiToken();
  const username = getConfig().get<string>('username') || '';
  let result = value;
  if (secret) {
    for (const variant of [secret, encodeURIComponent(secret), Buffer.from(`${username}:${secret}`).toString('base64')]) {
      result = result.split(variant).join('[REDACTED]');
    }
  }
  return result;
}