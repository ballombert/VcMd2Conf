import * as vscode from 'vscode';
import { SyncStatus, SyncSummary } from './types';
import { SyncManager } from './syncManager';
import { computeSummary, statusEmoji } from './utils';

/**
 * Manages the status bar item showing sync summary.
 * Displays a compact overview of sync status with color coding.
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private syncManager: SyncManager;

  constructor(syncManager: SyncManager) {
    this.syncManager = syncManager;

    // Create a status bar item on the left side
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'vcmd2conf.syncView.focus';
    this.statusBarItem.name = 'VcMd2Conf Sync Status';

    // Subscribe to file changes
    syncManager.onDidChangeFiles(() => this.update());

    this.update();
    this.statusBarItem.show();
  }

  /**
   * Update the status bar with current sync summary.
   */
  update(): void {
    const files = this.syncManager.getAllFileInfos();
    const summary = computeSummary(files);

    if (files.length === 0) {
      this.statusBarItem.text = '$(cloud) VcMd2Conf';
      this.statusBarItem.tooltip = 'No Markdown files found';
      this.statusBarItem.backgroundColor = undefined;
      return;
    }

    // Build compact status text
    const actionNeeded = summary.modified + summary.notSynced + summary.errors + summary.remoteNewer;

    if (actionNeeded > 0) {
      this.statusBarItem.text = `$(cloud-upload) ${actionNeeded} to sync`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
    } else if (summary.synced > 0) {
      this.statusBarItem.text = `$(pass-filled) ${summary.synced} synced`;
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = '$(cloud) VcMd2Conf';
      this.statusBarItem.backgroundColor = undefined;
    }

    // Build tooltip
    this.statusBarItem.tooltip = this.buildTooltip(summary);
  }

  private buildTooltip(summary: SyncSummary): string {
    const lines: string[] = ['VcMd2Conf — Confluence Sync', ''];

    if (summary.synced > 0) {
      lines.push(`  ✅ ${summary.synced} synced`);
    }
    if (summary.modified > 0) {
      lines.push(`  ⚠️  ${summary.modified} modified`);
    }
    if (summary.notSynced > 0) {
      lines.push(`  🔴 ${summary.notSynced} not synced`);
    }
    if (summary.remoteNewer > 0) {
      lines.push(`  ⬇️  ${summary.remoteNewer} remote newer`);
    }
    if (summary.errors > 0) {
      lines.push(`  ❌ ${summary.errors} errors`);
    }
    if (summary.noMetadata > 0) {
      lines.push(`  ⚪ ${summary.noMetadata} no metadata`);
    }

    lines.push('', `  Total: ${summary.total} files`);
    lines.push('', 'Click to open Confluence Sync panel');

    return lines.join('\n');
  }

  /**
   * Temporarily show a syncing indicator.
   */
  showSyncing(fileName: string): void {
    this.statusBarItem.text = `$(sync~spin) Syncing ${fileName}…`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.prominentBackground',
    );
  }

  /**
   * Flash a success message briefly.
   */
  showSuccess(fileName: string): void {
    this.statusBarItem.text = `$(pass-filled) ${fileName} synced!`;
    this.statusBarItem.backgroundColor = undefined;
    setTimeout(() => this.update(), 3000);
  }

  /**
   * Flash an error message briefly.
   */
  showError(fileName: string): void {
    this.statusBarItem.text = `$(error) ${fileName} sync failed`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground',
    );
    setTimeout(() => this.update(), 5000);
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
