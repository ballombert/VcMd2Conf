import * as vscode from 'vscode';
import { SyncStatus } from './types';
import { SyncManager } from './syncManager';

/**
 * Badge text and color for file explorer decorations.
 */
const STATUS_DECORATIONS: Record<SyncStatus, { badge: string; tooltip: string; color: string } | null> = {
  [SyncStatus.Synced]: {
    badge: '✓',
    tooltip: 'Synced with Confluence',
    color: 'vcmd2conf.synced',
  },
  [SyncStatus.Modified]: {
    badge: 'M',
    tooltip: 'Modified — needs re-sync',
    color: 'vcmd2conf.modified',
  },
  [SyncStatus.NotSynced]: {
    badge: 'N',
    tooltip: 'Has mark metadata — never synced',
    color: 'vcmd2conf.notSynced',
  },
  [SyncStatus.NoMetadata]: null, // No decoration for files without metadata
  [SyncStatus.Syncing]: {
    badge: '⟳',
    tooltip: 'Syncing…',
    color: 'vcmd2conf.syncing',
  },
  [SyncStatus.Error]: {
    badge: '!',
    tooltip: 'Sync error',
    color: 'vcmd2conf.notSynced',
  },
  [SyncStatus.RemoteNewer]: {
    badge: '↓',
    tooltip: 'Remote version is newer',
    color: 'vcmd2conf.modified',
  },
  [SyncStatus.Unknown]: null,
};

/**
 * Provides file decorations (badges + colors) for Markdown files
 * in the VS Code Explorer panel.
 */
export class SyncDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private syncManager: SyncManager;

  constructor(syncManager: SyncManager) {
    this.syncManager = syncManager;

    // Refresh decorations when file data changes
    syncManager.onDidChangeFiles(() => {
      this._onDidChangeFileDecorations.fire(undefined);
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Only decorate .md files
    if (!uri.fsPath.endsWith('.md')) {
      return undefined;
    }

    const fileInfo = this.syncManager.getFileInfo(uri.fsPath);
    if (!fileInfo) {
      return undefined;
    }

    const decoration = STATUS_DECORATIONS[fileInfo.status];
    if (!decoration) {
      return undefined;
    }

    return {
      badge: decoration.badge,
      tooltip: decoration.tooltip,
      color: new vscode.ThemeColor(decoration.color),
      propagate: false,
    };
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}
