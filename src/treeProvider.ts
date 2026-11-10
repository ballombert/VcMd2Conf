import * as path from 'path';
import * as vscode from 'vscode';
import { FileInfo, SyncStatus, ViewMode } from './types';
import { SyncManager } from './syncManager';
import {
  statusIconId,
  statusColor,
  statusLabel,
  statusEmoji,
  timeAgo,
  computeSummary,
} from './utils';

// ── Tree Item Types ──────────────────────────────────────────

/**
 * A tree item representing a folder in the file hierarchy.
 */
class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderPath: string,
    public readonly folderName: string,
    private readonly files: FileInfo[],
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'folder';
    this.resourceUri = vscode.Uri.file(folderPath);

    // Build summary description
    const summary = computeSummary(files);
    const parts: string[] = [];
    if (summary.synced > 0) { parts.push(`${summary.synced} ✓`); }
    if (summary.modified > 0) { parts.push(`${summary.modified} ✎`); }
    if (summary.notSynced > 0) { parts.push(`${summary.notSynced} ●`); }
    this.description = parts.join('  ');

    this.iconPath = new vscode.ThemeIcon('folder');

    this.tooltip = new vscode.MarkdownString(
      `### 📁 ${folderName}\n\n` +
      `| Status | Count |\n|--------|-------|\n` +
      `| ✅ Synced | ${summary.synced} |\n` +
      `| ⚠️ Modified | ${summary.modified} |\n` +
      `| 🔴 Not synced | ${summary.notSynced} |\n` +
      `| ⚪ No metadata | ${summary.noMetadata} |\n`,
    );
    (this.tooltip as vscode.MarkdownString).supportThemeIcons = true;
  }
}

/**
 * A tree item representing a status group (when in "by status" view mode).
 */
class StatusGroupItem extends vscode.TreeItem {
  constructor(
    public readonly status: SyncStatus,
    public readonly count: number,
  ) {
    super(
      `${statusEmoji(status)} ${statusLabel(status)}`,
      count > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.contextValue = 'statusGroup';
    this.description = `${count} file${count !== 1 ? 's' : ''}`;
    this.iconPath = new vscode.ThemeIcon(statusIconId(status), statusColor(status));
  }
}

/**
 * A tree item representing a single Markdown file.
 */
class FileItem extends vscode.TreeItem {
  public readonly fileInfo: FileInfo;

  constructor(fileInfo: FileInfo) {
    const fileName = path.basename(fileInfo.filePath);
    super(fileName, vscode.TreeItemCollapsibleState.None);

    this.fileInfo = fileInfo;
    this.contextValue = `mdFile.${fileInfo.status}`;
    this.resourceUri = vscode.Uri.file(fileInfo.filePath);

    // Icon with status color
    this.iconPath = new vscode.ThemeIcon(
      statusIconId(fileInfo.status),
      statusColor(fileInfo.status),
    );

    // Description line
    this.description = this.buildDescription();

    // Rich markdown tooltip
    this.tooltip = this.buildTooltip();

    // Click to open the file
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [vscode.Uri.file(fileInfo.filePath)],
    };
  }

  private buildDescription(): string {
    const parts: string[] = [];

    if (this.fileInfo.syncState) {
      parts.push(`v${this.fileInfo.syncState.confluenceVersion}`);
    }

    if (this.fileInfo.confluencePage) {
      const remoteVer = this.fileInfo.confluencePage.version.number;
      const localVer = this.fileInfo.syncState?.confluenceVersion || 0;
      if (remoteVer > localVer) {
        parts.push(`→ v${remoteVer} remote`);
      }
    }

    switch (this.fileInfo.status) {
      case SyncStatus.Synced:
        if (this.fileInfo.syncState) {
          parts.push(timeAgo(this.fileInfo.syncState.lastSyncTime));
        }
        break;
      case SyncStatus.Modified:
        parts.push('modified locally');
        break;
      case SyncStatus.NotSynced:
        parts.push('never synced');
        break;
      case SyncStatus.NoMetadata:
        parts.push('no mark headers');
        break;
      case SyncStatus.Syncing:
        parts.push('syncing…');
        break;
      case SyncStatus.Error:
        parts.push('error');
        break;
      case SyncStatus.RemoteNewer:
        parts.push('remote updated');
        break;
    }

    return parts.join(' · ');
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString('', true);
    md.supportThemeIcons = true;
    md.isTrusted = true;

    const fileName = path.basename(this.fileInfo.filePath);
    const emoji = statusEmoji(this.fileInfo.status);
    const label = statusLabel(this.fileInfo.status);

    md.appendMarkdown(`### $(markdown) ${fileName}\n\n`);
    md.appendMarkdown(`**Status:** ${emoji} ${label}\n\n`);

    if (this.fileInfo.metadata) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown('#### $(book) Mark Metadata\n\n');
      if (this.fileInfo.metadata.space) {
        md.appendMarkdown(`- **Space:** \`${this.fileInfo.metadata.space}\`\n`);
      }
      if (this.fileInfo.metadata.title) {
        md.appendMarkdown(`- **Title:** ${this.fileInfo.metadata.title}\n`);
      }
      if (this.fileInfo.metadata.parents?.length) {
        md.appendMarkdown(`- **Parents:** ${this.fileInfo.metadata.parents.join(' → ')}\n`);
      }
      if (this.fileInfo.metadata.labels?.length) {
        md.appendMarkdown(`- **Labels:** ${this.fileInfo.metadata.labels.map((l) => `\`${l}\``).join(', ')}\n`);
      }
    }

    if (this.fileInfo.syncState) {
      md.appendMarkdown('\n---\n\n');
      md.appendMarkdown('#### $(cloud) Confluence\n\n');
      md.appendMarkdown(`- **Page ID:** \`${this.fileInfo.syncState.confluencePageId}\`\n`);
      md.appendMarkdown(`- **Version:** ${this.fileInfo.syncState.confluenceVersion}\n`);
      md.appendMarkdown(`- **Last sync:** ${new Date(this.fileInfo.syncState.lastSyncTime).toLocaleString()}\n`);

      if (this.fileInfo.syncState.confluenceUrl) {
        md.appendMarkdown(`- **URL:** [Open in Confluence](${this.fileInfo.syncState.confluenceUrl})\n`);
      }
    }

    if (this.fileInfo.confluencePage) {
      const page = this.fileInfo.confluencePage;
      md.appendMarkdown('\n---\n\n');
      md.appendMarkdown('#### $(globe) Remote Status\n\n');
      md.appendMarkdown(`- **Remote version:** ${page.version.number}\n`);
      if (page.version.when) {
        md.appendMarkdown(`- **Last modified:** ${new Date(page.version.when).toLocaleString()}\n`);
      }
      if (page.version.by?.displayName) {
        md.appendMarkdown(`- **Modified by:** ${page.version.by.displayName}\n`);
      }
    }

    return md;
  }
}

type TreeNode = FolderItem | StatusGroupItem | FileItem;

// ── Tree Data Provider ───────────────────────────────────────

export class SyncTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private viewMode: ViewMode = ViewMode.ByFolder;

  constructor(private readonly syncManager: SyncManager) {
    // Refresh tree when file data changes
    syncManager.onDidChangeFiles(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  toggleViewMode(): void {
    this.viewMode =
      this.viewMode === ViewMode.ByFolder ? ViewMode.ByStatus : ViewMode.ByFolder;
    this.refresh();
  }

  getViewMode(): ViewMode {
    return this.viewMode;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      return this.viewMode === ViewMode.ByFolder
        ? this.getRootByFolder()
        : this.getRootByStatus();
    }

    if (element instanceof FolderItem) {
      return this.getFolderChildren(element);
    }

    if (element instanceof StatusGroupItem) {
      return this.getStatusGroupChildren(element);
    }

    return [];
  }

  // ── By Folder view ──

  private getRootByFolder(): TreeNode[] {
    const files = this.syncManager.getAllFileInfos();
    if (files.length === 0) {
      return [];
    }

    // Group files by their parent directory
    const dirMap = new Map<string, FileInfo[]>();
    for (const file of files) {
      const dir = path.dirname(file.relativePath);
      if (!dirMap.has(dir)) {
        dirMap.set(dir, []);
      }
      dirMap.get(dir)!.push(file);
    }

    // Sort directories
    const sortedDirs = Array.from(dirMap.keys()).sort();

    // If only one directory (root), show files directly
    if (sortedDirs.length === 1 && sortedDirs[0] === '.') {
      return this.sortFiles(dirMap.get('.')!).map((f) => new FileItem(f));
    }

    // Create folder items
    return sortedDirs.map((dir) => {
      const dirFiles = dirMap.get(dir)!;
      const absDir = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        dir,
      );
      const displayName = dir === '.' ? '.' : dir;
      return new FolderItem(absDir, displayName, dirFiles);
    });
  }

  private getFolderChildren(folder: FolderItem): TreeNode[] {
    const files = this.syncManager.getAllFileInfos().filter((f) => {
      const fileDir = path.dirname(f.relativePath);
      const folderRelPath = path.relative(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        folder.folderPath,
      ).replace(/\\/g, '/');
      return fileDir === folderRelPath || fileDir === '.';
    });

    return this.sortFiles(files).map((f) => new FileItem(f));
  }

  // ── By Status view ──

  private getRootByStatus(): TreeNode[] {
    const files = this.syncManager.getAllFileInfos();
    const groups: { status: SyncStatus; priority: number }[] = [
      { status: SyncStatus.Modified, priority: 0 },
      { status: SyncStatus.NotSynced, priority: 1 },
      { status: SyncStatus.RemoteNewer, priority: 2 },
      { status: SyncStatus.Error, priority: 3 },
      { status: SyncStatus.Synced, priority: 4 },
      { status: SyncStatus.NoMetadata, priority: 5 },
    ];

    return groups
      .map((g) => {
        const count = files.filter((f) => f.status === g.status).length;
        return new StatusGroupItem(g.status, count);
      })
      .filter((g) => g.count > 0);
  }

  private getStatusGroupChildren(group: StatusGroupItem): TreeNode[] {
    const files = this.syncManager
      .getAllFileInfos()
      .filter((f) => f.status === group.status);

    return this.sortFiles(files).map((f) => new FileItem(f));
  }

  // ── Helpers ──

  private sortFiles(files: FileInfo[]): FileInfo[] {
    // Sort: actionable statuses first, then alphabetically
    const statusPriority: Record<SyncStatus, number> = {
      [SyncStatus.Error]: 0,
      [SyncStatus.Modified]: 1,
      [SyncStatus.RemoteNewer]: 2,
      [SyncStatus.NotSynced]: 3,
      [SyncStatus.Syncing]: 4,
      [SyncStatus.Synced]: 5,
      [SyncStatus.NoMetadata]: 6,
      [SyncStatus.Unknown]: 7,
    };

    return [...files].sort((a, b) => {
      const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.relativePath.localeCompare(b.relativePath);
    });
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Export FileItem for external use (e.g., in commands).
 */
export { FileItem, FolderItem };
