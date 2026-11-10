/**
 * Sync status for a Markdown file relative to Confluence.
 */
export enum SyncStatus {
  /** File content matches last synced version */
  Synced = 'synced',
  /** File has been modified locally since last sync */
  Modified = 'modified',
  /** File has mark metadata but has never been synced */
  NotSynced = 'not-synced',
  /** File has no mark metadata (Space/Title headers) */
  NoMetadata = 'no-metadata',
  /** Currently being synced */
  Syncing = 'syncing',
  /** Sync or version check encountered an error */
  Error = 'error',
  /** Remote version is newer than local */
  RemoteNewer = 'remote-newer',
  /** Status hasn't been determined yet */
  Unknown = 'unknown',
}

/**
 * Metadata extracted from a Markdown file's mark headers or frontmatter.
 * Corresponds to the fields `mark` uses for Confluence targeting.
 */
export interface MarkMetadata {
  space?: string;
  title?: string;
  parents?: string[];
  labels?: string[];
}

/**
 * Persisted sync state for a single file.
 * Stored in `.vcmd2conf.json` in the workspace root.
 */
export interface SyncState {
  /** MD5 hash of file content at last successful sync */
  lastSyncHash: string;
  /** ISO-8601 timestamp of last successful sync */
  lastSyncTime: string;
  /** Confluence page ID */
  confluencePageId: string;
  /** Confluence page version number at last sync */
  confluenceVersion: number;
  /** Full URL to the Confluence page */
  confluenceUrl: string;
  /** Space key used for syncing */
  space: string;
  /** Page title in Confluence */
  title: string;
}

/**
 * Root structure of the `.vcmd2conf.json` cache file.
 */
export interface SyncStateCache {
  /** Schema version for forward compatibility */
  version: number;
  /** Map of relative file paths to their sync states */
  files: Record<string, SyncState>;
}

/**
 * Partial representation of a Confluence page from the REST API.
 */
export interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  version: {
    number: number;
    when: string;
    by?: {
      displayName: string;
    };
    message?: string;
  };
  _links: {
    webui: string;
    base?: string;
    self?: string;
  };
}

/**
 * Complete computed info for a file, combining local and remote data.
 */
export interface FileInfo {
  /** Absolute path to the Markdown file */
  filePath: string;
  /** Path relative to workspace root */
  relativePath: string;
  /** Parsed mark metadata from the file, or null if none found */
  metadata: MarkMetadata | null;
  /** Persisted sync state from cache, or null if never synced */
  syncState: SyncState | null;
  /** MD5 hash of current file contents */
  currentHash: string;
  /** Computed sync status */
  status: SyncStatus;
  /** Remote Confluence page info, or null if not fetched/available */
  confluencePage: ConfluencePage | null;
}

/**
 * Summary statistics for the status bar.
 */
export interface SyncSummary {
  total: number;
  synced: number;
  modified: number;
  notSynced: number;
  noMetadata: number;
  errors: number;
  remoteNewer: number;
}

/**
 * Result of a mark CLI execution.
 */
export interface MarkResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Parsed page URL from mark output, if available */
  pageUrl?: string;
  /** Parsed page ID from mark output, if available */
  pageId?: string;
}

/**
 * View modes for the tree provider.
 */
export enum ViewMode {
  /** Group by filesystem folder hierarchy */
  ByFolder = 'folder',
  /** Group by sync status */
  ByStatus = 'status',
}
