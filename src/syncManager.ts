import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SyncState, SyncStateCache, SyncStatus, FileInfo } from './types';
import { getWorkspaceRoot, md5, toRelativePath } from './utils';
import { parseFile } from './markParser';
import { ConfluenceApi } from './confluenceApi';

const CACHE_FILE = '.vcmd2conf.json';
const CACHE_VERSION = 1;

/**
 * Manages the sync state cache and file scanning.
 * Acts as the central data store for all file information.
 */
export class SyncManager {
  private cache: SyncStateCache = { version: CACHE_VERSION, files: {} };
  private fileInfos: Map<string, FileInfo> = new Map();
  private confluenceApi: ConfluenceApi;
  private _onDidChangeFiles = new vscode.EventEmitter<void>();
  readonly onDidChangeFiles = this._onDidChangeFiles.event;

  constructor(confluenceApi: ConfluenceApi) {
    this.confluenceApi = confluenceApi;
    this.loadCache();
  }

  /**
   * Get all tracked file infos.
   */
  getAllFileInfos(): FileInfo[] {
    return Array.from(this.fileInfos.values());
  }

  /**
   * Get file info by absolute path.
   */
  getFileInfo(filePath: string): FileInfo | undefined {
    return this.fileInfos.get(filePath);
  }

  /**
   * Scan the workspace for Markdown files and compute statuses.
   */
  async scanWorkspace(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
      return;
    }

    const config = vscode.workspace.getConfiguration('vcmd2conf');
    const excludePatterns = config.get<string[]>('excludePatterns') || [];

    // Find all .md files
    const includePattern = '**/*.md';
    const excludePattern = excludePatterns.length > 0
      ? `{${excludePatterns.join(',')}}`
      : undefined;

    const files = await vscode.workspace.findFiles(includePattern, excludePattern);

    // Clear and rebuild
    this.fileInfos.clear();

    // Process files in parallel batches
    const batchSize = 20;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.all(batch.map((uri) => this.processFile(uri.fsPath)));
    }

    this._onDidChangeFiles.fire();
  }

  /**
   * Process a single file: parse metadata, compute hash, determine status.
   */
  async processFile(filePath: string): Promise<FileInfo> {
    const relativePath = toRelativePath(filePath);

    try {
      const { metadata, hash } = await parseFile(filePath);
      const syncState = this.cache.files[relativePath] || null;

      let status: SyncStatus;

      if (!metadata || (!metadata.space && !metadata.title)) {
        status = SyncStatus.NoMetadata;
      } else if (!syncState) {
        status = SyncStatus.NotSynced;
      } else if (syncState.lastSyncHash === hash) {
        status = SyncStatus.Synced;
      } else {
        status = SyncStatus.Modified;
      }

      const fileInfo: FileInfo = {
        filePath,
        relativePath,
        metadata,
        syncState,
        currentHash: hash,
        status,
        confluencePage: null,
      };

      this.fileInfos.set(filePath, fileInfo);
      return fileInfo;
    } catch (err) {
      const fileInfo: FileInfo = {
        filePath,
        relativePath,
        metadata: null,
        syncState: null,
        currentHash: '',
        status: SyncStatus.Error,
        confluencePage: null,
      };
      this.fileInfos.set(filePath, fileInfo);
      return fileInfo;
    }
  }

  /**
   * Update a single file's status (e.g., after editing).
   */
  async refreshFile(filePath: string): Promise<void> {
    await this.processFile(filePath);
    this._onDidChangeFiles.fire();
  }

  /**
   * Record a successful sync for a file.
   */
  recordSync(
    filePath: string,
    pageId: string,
    pageUrl: string,
    version: number,
    space: string,
    title: string,
  ): void {
    const relativePath = toRelativePath(filePath);
    const fileInfo = this.fileInfos.get(filePath);

    const syncState: SyncState = {
      lastSyncHash: fileInfo?.currentHash || '',
      lastSyncTime: new Date().toISOString(),
      confluencePageId: pageId,
      confluenceVersion: version,
      confluenceUrl: pageUrl,
      space,
      title,
    };

    this.cache.files[relativePath] = syncState;
    this.saveCache();

    // Update the file info
    if (fileInfo) {
      fileInfo.syncState = syncState;
      fileInfo.status = SyncStatus.Synced;
      this._onDidChangeFiles.fire();
    }
  }

  /**
   * Check remote versions for all synced/modified files.
   */
  async checkRemoteVersions(): Promise<void> {
    if (!this.confluenceApi.isConfigured()) {
      return;
    }

    const filesToCheck = Array.from(this.fileInfos.values()).filter(
      (f) => f.metadata && f.syncState,
    );

    // Check in parallel batches
    const batchSize = 5;
    for (let i = 0; i < filesToCheck.length; i += batchSize) {
      const batch = filesToCheck.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (fileInfo) => {
          if (!fileInfo.syncState || !fileInfo.metadata) {
            return;
          }

          try {
            let page: import('./types').ConfluencePage | null = null;

            if (fileInfo.syncState.confluencePageId) {
              page = await this.confluenceApi.getPageById(fileInfo.syncState.confluencePageId);
            } else if (fileInfo.metadata.space && fileInfo.metadata.title) {
              page = await this.confluenceApi.getPageByTitle(
                fileInfo.metadata.space,
                fileInfo.metadata.title,
              );
            }

            if (page) {
              fileInfo.confluencePage = page;

              // Check if remote version is newer
              if (page.version.number > fileInfo.syncState.confluenceVersion) {
                if (fileInfo.status === SyncStatus.Synced) {
                  fileInfo.status = SyncStatus.RemoteNewer;
                }
              }

              // Update the URL in cache
              const newUrl = this.confluenceApi.getPageWebUrl(page);
              if (newUrl !== fileInfo.syncState.confluenceUrl) {
                fileInfo.syncState.confluenceUrl = newUrl;
                const relativePath = toRelativePath(fileInfo.filePath);
                this.cache.files[relativePath] = fileInfo.syncState;
                this.saveCache();
              }
            }
          } catch {
            // Silently skip failed version checks
          }
        }),
      );
    }

    this._onDidChangeFiles.fire();
  }

  /**
   * Check remote version for a single file.
   */
  async checkRemoteVersion(filePath: string): Promise<void> {
    const fileInfo = this.fileInfos.get(filePath);
    if (!fileInfo?.metadata || !this.confluenceApi.isConfigured()) {
      return;
    }

    try {
      let page: import('./types').ConfluencePage | null = null;

      if (fileInfo.syncState?.confluencePageId) {
        page = await this.confluenceApi.getPageById(fileInfo.syncState.confluencePageId);
      } else if (fileInfo.metadata.space && fileInfo.metadata.title) {
        page = await this.confluenceApi.getPageByTitle(
          fileInfo.metadata.space,
          fileInfo.metadata.title,
        );
      }

      if (page) {
        fileInfo.confluencePage = page;

        if (fileInfo.syncState && page.version.number > fileInfo.syncState.confluenceVersion) {
          if (fileInfo.status === SyncStatus.Synced) {
            fileInfo.status = SyncStatus.RemoteNewer;
          }
        }
      }

      this._onDidChangeFiles.fire();
    } catch (err) {
      console.error('[VcMd2Conf] Failed to check remote version:', err);
    }
  }

  // ── Cache persistence ──────────────────────────────────────

  private getCachePath(): string | undefined {
    const root = getWorkspaceRoot();
    return root ? path.join(root, CACHE_FILE) : undefined;
  }

  private loadCache(): void {
    const cachePath = this.getCachePath();
    if (!cachePath) {
      return;
    }

    try {
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, 'utf-8');
        const parsed = JSON.parse(raw) as SyncStateCache;
        if (parsed.version === CACHE_VERSION) {
          this.cache = parsed;
        }
      }
    } catch {
      // Start with empty cache
      this.cache = { version: CACHE_VERSION, files: {} };
    }
  }

  private saveCache(): void {
    const cachePath = this.getCachePath();
    if (!cachePath) {
      return;
    }

    try {
      fs.writeFileSync(cachePath, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch (err) {
      console.error('[VcMd2Conf] Failed to save cache:', err);
    }
  }

  dispose(): void {
    this._onDidChangeFiles.dispose();
  }
}
