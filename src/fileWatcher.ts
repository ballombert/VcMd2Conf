import * as vscode from 'vscode';
import { SyncManager } from './syncManager';

/**
 * Watches for file changes in the workspace and triggers re-scanning.
 * Uses VS Code's FileSystemWatcher for efficient monitoring.
 */
export class FileWatcherManager {
  private watcher: vscode.FileSystemWatcher;
  private debounceTimer: NodeJS.Timeout | undefined;
  private syncManager: SyncManager;

  constructor(syncManager: SyncManager) {
    this.syncManager = syncManager;

    // Watch for .md file changes
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.md');

    this.watcher.onDidChange((uri) => this.onFileChanged(uri));
    this.watcher.onDidCreate((uri) => this.onFileCreated(uri));
    this.watcher.onDidDelete((uri) => this.onFileDeleted(uri));
  }

  private onFileChanged(uri: vscode.Uri): void {
    const config = vscode.workspace.getConfiguration('vcmd2conf');
    if (!config.get<boolean>('autoRefresh', true)) {
      return;
    }

    // Debounce: wait for user to stop typing
    this.debounceRefreshFile(uri.fsPath);
  }

  private onFileCreated(uri: vscode.Uri): void {
    // Immediately process new files
    this.syncManager.refreshFile(uri.fsPath);
  }

  private onFileDeleted(_uri: vscode.Uri): void {
    // Re-scan workspace on deletion
    this.debouncedFullScan();
  }

  private debounceRefreshFile(filePath: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.syncManager.refreshFile(filePath);
    }, 1000);
  }

  private debouncedFullScan(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.syncManager.scanWorkspace();
    }, 2000);
  }

  dispose(): void {
    this.watcher.dispose();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }
}
