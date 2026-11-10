import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { SyncStatus, SyncSummary, FileInfo } from './types';

/**
 * Compute MD5 hash of a string.
 */
export function md5(content: string): string {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

/**
 * Format a relative time string from an ISO timestamp.
 */
export function timeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString();
}

/**
 * Get a human-readable status label.
 */
export function statusLabel(status: SyncStatus): string {
  switch (status) {
    case SyncStatus.Synced:
      return 'Synced';
    case SyncStatus.Modified:
      return 'Modified';
    case SyncStatus.NotSynced:
      return 'Not synced';
    case SyncStatus.NoMetadata:
      return 'No metadata';
    case SyncStatus.Syncing:
      return 'Syncing…';
    case SyncStatus.Error:
      return 'Error';
    case SyncStatus.RemoteNewer:
      return 'Remote newer';
    case SyncStatus.Unknown:
      return 'Unknown';
  }
}

/**
 * Get a status emoji for display.
 */
export function statusEmoji(status: SyncStatus): string {
  switch (status) {
    case SyncStatus.Synced:
      return '✅';
    case SyncStatus.Modified:
      return '⚠️';
    case SyncStatus.NotSynced:
      return '🔴';
    case SyncStatus.NoMetadata:
      return '⚪';
    case SyncStatus.Syncing:
      return '🔄';
    case SyncStatus.Error:
      return '❌';
    case SyncStatus.RemoteNewer:
      return '⬇️';
    case SyncStatus.Unknown:
      return '❓';
  }
}

/**
 * Get the codicon ID for a sync status.
 */
export function statusIconId(status: SyncStatus): string {
  switch (status) {
    case SyncStatus.Synced:
      return 'pass-filled';
    case SyncStatus.Modified:
      return 'warning';
    case SyncStatus.NotSynced:
      return 'circle-large-outline';
    case SyncStatus.NoMetadata:
      return 'circle-slash';
    case SyncStatus.Syncing:
      return 'sync~spin';
    case SyncStatus.Error:
      return 'error';
    case SyncStatus.RemoteNewer:
      return 'arrow-down';
    case SyncStatus.Unknown:
      return 'question';
  }
}

/**
 * Get the ThemeColor for a sync status.
 */
export function statusColor(status: SyncStatus): vscode.ThemeColor {
  switch (status) {
    case SyncStatus.Synced:
      return new vscode.ThemeColor('vcmd2conf.synced');
    case SyncStatus.Modified:
      return new vscode.ThemeColor('vcmd2conf.modified');
    case SyncStatus.NotSynced:
      return new vscode.ThemeColor('vcmd2conf.notSynced');
    case SyncStatus.NoMetadata:
      return new vscode.ThemeColor('vcmd2conf.noMetadata');
    case SyncStatus.Syncing:
      return new vscode.ThemeColor('vcmd2conf.syncing');
    case SyncStatus.Error:
      return new vscode.ThemeColor('vcmd2conf.notSynced');
    case SyncStatus.RemoteNewer:
      return new vscode.ThemeColor('vcmd2conf.modified');
    case SyncStatus.Unknown:
      return new vscode.ThemeColor('vcmd2conf.noMetadata');
  }
}

/**
 * Compute sync summary from a list of FileInfos.
 */
export function computeSummary(files: FileInfo[]): SyncSummary {
  const summary: SyncSummary = {
    total: files.length,
    synced: 0,
    modified: 0,
    notSynced: 0,
    noMetadata: 0,
    errors: 0,
    remoteNewer: 0,
  };
  for (const file of files) {
    switch (file.status) {
      case SyncStatus.Synced:
        summary.synced++;
        break;
      case SyncStatus.Modified:
        summary.modified++;
        break;
      case SyncStatus.NotSynced:
        summary.notSynced++;
        break;
      case SyncStatus.NoMetadata:
        summary.noMetadata++;
        break;
      case SyncStatus.Error:
        summary.errors++;
        break;
      case SyncStatus.RemoteNewer:
        summary.remoteNewer++;
        break;
    }
  }
  return summary;
}

/**
 * Get workspace root folder path.
 */
export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Convert an absolute path to a path relative to workspace root.
 */
export function toRelativePath(absolutePath: string): string {
  const root = getWorkspaceRoot();
  if (root) {
    return path.relative(root, absolutePath).replace(/\\/g, '/');
  }
  return absolutePath;
}

/**
 * Get the extension configuration.
 */
export function getConfig() {
  return vscode.workspace.getConfiguration('vcmd2conf');
}
