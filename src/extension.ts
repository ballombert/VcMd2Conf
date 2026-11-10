import * as path from 'path';
import * as vscode from 'vscode';
import { SyncStatus } from './types';
import { ConfluenceApi } from './confluenceApi';
import { SyncManager } from './syncManager';
import { SyncTreeDataProvider, FileItem, FolderItem } from './treeProvider';
import { StatusBarManager } from './statusBar';
import { FileWatcherManager } from './fileWatcher';
import { SyncDecorationProvider } from './decorationProvider';
import { syncFile, syncFolder, checkMarkAvailable, disposeOutputChannel, showMarkOutput, describeMarkError } from './markRunner';
import { getConfig, toRelativePath, getWorkspaceRoot } from './utils';
import { initializeCredentials } from './credentials';
import { openConfiguration } from './configurationPanel';

/**
 * Extension activation entry point.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[VcMd2Conf] Activating extension...');
  await initializeCredentials(context.secrets);

  // ── Core services ──────────────────────────────────────────
  const confluenceApi = new ConfluenceApi();
  const syncManager = new SyncManager(confluenceApi);
  const treeProvider = new SyncTreeDataProvider(syncManager);
  const statusBarManager = new StatusBarManager(syncManager);
  const fileWatcher = new FileWatcherManager(syncManager);
  const decorationProvider = new SyncDecorationProvider(syncManager);

  // ── Register TreeView ──────────────────────────────────────
  const treeView = vscode.window.createTreeView('vcmd2conf.syncView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // ── Register file decorations ──────────────────────────────
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorationProvider),
  );

  // ── Register commands ──────────────────────────────────────

  // Sync single file
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.syncFile', async (arg?: FileItem | vscode.Uri) => {
      let filePath: string;

      if (arg instanceof FileItem) {
        filePath = arg.fileInfo.filePath;
      } else if (arg instanceof vscode.Uri) {
        filePath = arg.fsPath;
      } else {
        // Use active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
          vscode.window.showWarningMessage('No Markdown file selected.');
          return;
        }
        filePath = editor.document.fileName;
      }

      await doSyncFile(filePath, syncManager, statusBarManager, confluenceApi);
    }),
  );

  // Sync folder
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.syncFolder', async (arg?: FolderItem | vscode.Uri) => {
      let folderPath: string;

      if (arg instanceof FolderItem) {
        folderPath = arg.folderPath;
      } else if (arg instanceof vscode.Uri) {
        folderPath = arg.fsPath;
      } else {
        const root = getWorkspaceRoot();
        if (!root) {
          vscode.window.showWarningMessage('No workspace folder open.');
          return;
        }
        folderPath = root;
      }

      await doSyncFolder(folderPath, syncManager, statusBarManager);
    }),
  );

  // Sync all
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.syncAll', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }

      const files = syncManager.getAllFileInfos().filter(
        (f) =>
          f.status === SyncStatus.Modified ||
          f.status === SyncStatus.NotSynced,
      );

      if (files.length === 0) {
        vscode.window.showInformationMessage('$(pass-filled) All files are already synced!');
        return;
      }

      const confirm = await vscode.window.showInformationMessage(
        `Sync ${files.length} file(s) to Confluence?`,
        { modal: true },
        'Sync All',
      );

      if (confirm !== 'Sync All') {
        return;
      }

      let successCount = 0;
      let failCount = 0;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Syncing to Confluence',
          cancellable: true,
        },
        async (progress, token) => {
          for (let i = 0; i < files.length; i++) {
            if (token.isCancellationRequested) {
              break;
            }

            const file = files[i];
            const fileName = path.basename(file.filePath);
            progress.report({
              message: `${fileName} (${i + 1}/${files.length})`,
              increment: 100 / files.length,
            });

            const success = await doSyncFile(
              file.filePath,
              syncManager,
              statusBarManager,
              confluenceApi,
              false,
            );

            if (success) {
              successCount++;
            } else {
              failCount++;
            }
          }
        },
      );

      const config = getConfig();
      if (config.get<boolean>('showNotifications', true)) {
        if (failCount === 0) {
          vscode.window.showInformationMessage(
            `$(pass-filled) Successfully synced ${successCount} file(s) to Confluence!`,
          );
        } else {
          vscode.window.showWarningMessage(
            `Synced ${successCount} file(s), ${failCount} failed. Check the output channel for details.`,
          );
        }
      }
    }),
  );

  // Refresh
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.refresh', async () => {
      await vscode.window.withProgress(
        {
          location: { viewId: 'vcmd2conf.syncView' },
        },
        async () => {
          await syncManager.scanWorkspace();
          if (confluenceApi.isConfigured()) {
            await syncManager.checkRemoteVersions();
          }
        },
      );
    }),
  );

  // Open in Confluence
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.openInConfluence', (arg?: FileItem) => {
      let url: string | undefined;

      if (arg instanceof FileItem) {
        url = arg.fileInfo.syncState?.confluenceUrl;
        if (!url && arg.fileInfo.confluencePage) {
          url = confluenceApi.getPageWebUrl(arg.fileInfo.confluencePage);
        }
      }

      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      } else {
        vscode.window.showWarningMessage('No Confluence URL available for this file.');
      }
    }),
  );

  // Check remote version
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.checkRemoteVersion', async (arg?: FileItem) => {
      if (!(arg instanceof FileItem)) {
        return;
      }

      if (!confluenceApi.isConfigured()) {
        vscode.window.showWarningMessage(
          'Confluence API not configured. Open VcMd2Conf configuration and set the URL and PAT (plus email for Cloud).',
        );
        return;
      }

      await vscode.window.withProgress(
        {
          location: { viewId: 'vcmd2conf.syncView' },
        },
        async () => {
          await syncManager.checkRemoteVersion(arg.fileInfo.filePath);
        },
      );

      const fileInfo = syncManager.getFileInfo(arg.fileInfo.filePath);
      if (fileInfo?.confluencePage) {
        const page = fileInfo.confluencePage;
        const localVer = fileInfo.syncState?.confluenceVersion || 0;
        const remoteVer = page.version.number;

        if (remoteVer > localVer) {
          vscode.window.showWarningMessage(
            `Remote version (v${remoteVer}) is newer than synced version (v${localVer}).`,
          );
        } else {
          vscode.window.showInformationMessage(
            `$(pass-filled) Page is at v${remoteVer} — up to date.`,
          );
        }
      }
    }),
  );

  // Toggle view mode
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.toggleViewMode', () => {
      treeProvider.toggleViewMode();
      const mode = treeProvider.getViewMode();
      vscode.window.showInformationMessage(
        `View mode: ${mode === 'folder' ? '📁 By Folder' : '📊 By Status'}`,
      );
    }),
  );

  // Configure
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.configure', () => {
      openConfiguration(context, confluenceApi);
    }),
    vscode.commands.registerCommand('vcmd2conf.output.focus', showMarkOutput),
  );

  // ── Welcome view when tree is empty ────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('vcmd2conf.welcome', () => {
      vscode.commands.executeCommand('vcmd2conf.configure');
    }),
  );

  // ── Listen for config changes ──────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vcmd2conf')) {
        confluenceApi.refreshConfig();
        // Re-scan if relevant settings changed
        if (
          e.affectsConfiguration('vcmd2conf.excludePatterns') ||
          e.affectsConfiguration('vcmd2conf.defaultSpace')
        ) {
          syncManager.scanWorkspace();
        }
      }
    }),
  );

  // ── Periodic remote version check ──────────────────────────
  const config = getConfig();
  const autoRefreshInterval = config.get<number>('autoRefreshInterval', 60);

  let periodicTimer: NodeJS.Timeout | undefined;
  if (confluenceApi.isConfigured()) {
    periodicTimer = setInterval(
      () => syncManager.checkRemoteVersions(),
      autoRefreshInterval * 1000,
    );
  }

  // ── Disposables ────────────────────────────────────────────
  context.subscriptions.push(
    treeView,
    { dispose: () => syncManager.dispose() },
    { dispose: () => statusBarManager.dispose() },
    { dispose: () => fileWatcher.dispose() },
    { dispose: () => decorationProvider.dispose() },
    { dispose: () => treeProvider.dispose() },
    { dispose: () => disposeOutputChannel() },
    {
      dispose: () => {
        if (periodicTimer) {
          clearInterval(periodicTimer);
        }
      },
    },
  );

  // ── Initial scan ───────────────────────────────────────────
  await syncManager.scanWorkspace();

  // Check mark availability on first activation
  const markAvailable = await checkMarkAvailable();
  if (!markAvailable) {
    const action = await vscode.window.showWarningMessage(
      'VcMd2Conf: mark CLI not found. Install it to enable Confluence sync.',
      'Install mark',
      'Configure Path',
      'Dismiss',
    );
    if (action === 'Install mark' || action === 'Configure Path') {
      openConfiguration(context, confluenceApi);
    }
  }

  console.log('[VcMd2Conf] Extension activated successfully.');
}

/**
 * Sync a single file to Confluence.
 * Returns true if successful.
 */
async function doSyncFile(
  filePath: string,
  syncManager: SyncManager,
  statusBarManager: StatusBarManager,
  confluenceApi: ConfluenceApi,
  showNotification = true,
): Promise<boolean> {
  const fileName = path.basename(filePath);
  const fileInfo = syncManager.getFileInfo(filePath);

  if (!fileInfo?.metadata) {
    if (showNotification) {
      vscode.window.showWarningMessage(
        `${fileName} has no mark metadata (Space/Title). Add mark headers to sync.`,
      );
    }
    return false;
  }

  statusBarManager.showSyncing(fileName);

  const result = await syncFile(filePath);

  if (result.success) {
    statusBarManager.showSuccess(fileName);

    // Try to get page info from Confluence API for version tracking
    let pageId = result.pageId || '';
    let pageUrl = result.pageUrl || '';
    let version = 1;

    if (confluenceApi.isConfigured() && fileInfo.metadata.space && fileInfo.metadata.title) {
      const page = await confluenceApi.getPageByTitle(
        fileInfo.metadata.space,
        fileInfo.metadata.title,
      );
      if (page) {
        pageId = page.id;
        pageUrl = confluenceApi.getPageWebUrl(page);
        version = page.version.number;
      }
    }

    // If we still don't have a URL, use whatever mark gave us
    if (!pageUrl && result.pageUrl) {
      pageUrl = result.pageUrl;
    }

    syncManager.recordSync(
      filePath,
      pageId,
      pageUrl,
      version,
      fileInfo.metadata.space || '',
      fileInfo.metadata.title || '',
    );

    if (showNotification) {
      const config = getConfig();
      if (config.get<boolean>('showNotifications', true)) {
        const action = await vscode.window.showInformationMessage(
          `$(pass-filled) ${fileName} synced to Confluence (v${version})`,
          'Open in Confluence',
        );
        if (action === 'Open in Confluence' && pageUrl) {
          vscode.env.openExternal(vscode.Uri.parse(pageUrl));
        }
      }
    }

    return true;
  } else {
    statusBarManager.showError(fileName);

    if (showNotification) {
      const action = await vscode.window.showErrorMessage(
        `Failed to sync ${fileName}. ${describeMarkError(result)}`,
        'Show Output',
        'Configure',
      );
      if (action === 'Show Output') {
        showMarkOutput();
      } else if (action === 'Configure') {
        await vscode.commands.executeCommand('vcmd2conf.configure');
      }
    }

    return false;
  }
}

/**
 * Sync all Markdown files in a folder.
 */
async function doSyncFolder(
  folderPath: string,
  syncManager: SyncManager,
  statusBarManager: StatusBarManager,
): Promise<void> {
  const folderName = path.basename(folderPath);
  statusBarManager.showSyncing(folderName);

  const result = await syncFolder(folderPath);

  if (result.success) {
    statusBarManager.showSuccess(folderName);

    const config = getConfig();
    if (config.get<boolean>('showNotifications', true)) {
      vscode.window.showInformationMessage(
        `$(pass-filled) Folder "${folderName}" synced to Confluence!`,
      );
    }

    // Re-scan to pick up changes
    await syncManager.scanWorkspace();
  } else {
    statusBarManager.showError(folderName);
    const action = await vscode.window.showErrorMessage(
      `Failed to sync folder "${folderName}". ${describeMarkError(result)}`,
      'Show Output',
      'Configure',
    );
    if (action === 'Show Output') { showMarkOutput(); }
    if (action === 'Configure') { await vscode.commands.executeCommand('vcmd2conf.configure'); }
  }
}

/**
 * Extension deactivation.
 */
export function deactivate(): void {
  console.log('[VcMd2Conf] Extension deactivated.');
}
