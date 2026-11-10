# VcMd2Conf — Markdown ↔ Confluence

> Synchronize your Markdown documentation with Confluence using [mark](https://github.com/kovetskiy/mark) CLI — with visual sync status, one-click publish, and version tracking.

![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### 🌳 Sidebar Tree View
A dedicated **Confluence Sync** panel in the Activity Bar showing all your Markdown files with real-time sync status:
- **✅ Green** — Synced and up to date
- **⚠️ Yellow** — Modified locally, needs re-sync
- **🔴 Red** — Has mark metadata but never synced
- **⚪ Grey** — No mark metadata (Space/Title headers)
- **⬇️ Blue** — Remote version is newer
- **🔄 Spinning** — Currently syncing

### 📊 Two View Modes
Toggle between:
- **📁 By Folder** — Files organized by directory structure
- **📊 By Status** — Files grouped by sync status (actionable first)

### 🏷️ File Explorer Decorations
Visual badges directly on `.md` files in the VS Code Explorer:
- `✓` Synced | `M` Modified | `N` Not synced | `!` Error | `↓` Remote newer

### 📈 Status Bar
Compact sync summary in the status bar:
- Shows count of files needing sync
- Warning background when action needed
- Click to focus the Confluence Sync panel

### 💡 Rich Tooltips
Hover over any file in the tree to see:
- Full mark metadata (Space, Title, Parents, Labels)
- Confluence page info (ID, version, last sync time)
- Remote version comparison
- Direct link to open in Confluence

### ⚡ Context Menu Integration
- Right-click any `.md` file → **Sync to Confluence**
- Right-click any folder → **Sync Folder to Confluence**
- Editor title bar → Sync button for active file

## 📋 Prerequisites

### 1. Install mark CLI
```bash
# macOS
brew install kovetskiy/mark/mark

# Go install
go install github.com/kovetskiy/mark/v17/cmd/mark@latest

# Or download binary from GitHub releases
# https://github.com/kovetskiy/mark/releases
```

### 2. Configure mark metadata in your Markdown files

Publishing enables `--title-from-h1`, so a leading H1 heading can supply the page
title when no explicit title metadata is recognized. The extension enables
`frontmatter` automatically for YAML metadata.

#### HTML Comment Headers (default):
```markdown
<!-- Space: DOCS -->
<!-- Title: My Documentation Page -->
<!-- Parent: Guides -->

# My Documentation Page
Content here...
```

#### YAML Frontmatter
The extension enables mark's `frontmatter` feature automatically for file and folder publishing.
```yaml
---
space: DOCS
title: My Documentation Page
parents:
  - Guides
labels:
  - documentation
---

# My Documentation Page
Content here...
```

## ⚙️ Configuration

Open **VcMd2Conf: Configure Confluence Connection** from the Command Palette,
or use the gear button in the Confluence Sync view.

The configuration screen includes the Confluence URL, username/email, masked
PAT/API token, default space, mark executable picker, features and optional mark
configuration file. Save settings, test the connection, verify mark, or install it
for the operating system running the extension (including remote hosts).

- **Confluence Cloud:** enter your email and API token; include `/wiki` in the URL.
- **Confluence Server/Data Center PAT:** leave the username empty to use Bearer authentication.
- **Token storage:** new tokens use VS Code SecretStorage, never the webview HTML.
  Leave the token field blank to keep it, or use the checkbox to delete it.
  Saving also moves the legacy `vcmd2conf.apiToken` setting into SecretStorage and
  removes its plaintext value from the active settings scopes.
- **Settings scope:** non-secret fields are saved to the current workspace, or
  user settings when no workspace is open. The token is stored per extension/user,
  not per workspace; changing it affects other workspaces using the extension.
- **Install mark v17:** installation requires confirmation and a trusted workspace.
  macOS/Linux use the official GitHub archive for the host CPU, verified against
  the release SHA-256 checksums. `tar` must be available.
  The current official release has no Windows archive: Windows falls back to
  `go install`, so install [Go](https://go.dev/dl/) and restart VS Code first.
  The executable is kept in the extension's private storage and its path is saved
  automatically. No administrator privileges or system PATH changes are needed.
- **Existing mark config:** an explicit configuration file keeps priority for CLI
  authentication. The connection test uses the URL and token from this screen.

Failed sync notifications include the exit code, error details and a suggested
fix, with **Show Output** and **Configure** actions. The output channel masks the
configured token, and the token is passed to mark through stdin rather than CLI
arguments. Mermaid rendering may additionally require Chrome/Chromium, depending
on the mark renderer configuration.

| Setting | Default | Description |
|---------|---------|-------------|
| `vcmd2conf.markPath` | `mark` | Path to mark executable |
| `vcmd2conf.baseUrl` | `""` | Confluence base URL |
| `vcmd2conf.username` | `""` | Confluence username/email |
| `vcmd2conf.apiToken` | `""` | Deprecated legacy token setting; use the configuration screen and SecretStorage |
| `vcmd2conf.defaultSpace` | `""` | Fallback for single-file sync; applies to all files in folder sync |
| `vcmd2conf.markConfigPath` | `""` | Path to mark config file (ci.toml) |
| `vcmd2conf.markFeatures` | `""` | Additional mark features (e.g., `mermaid`); `frontmatter` is enabled automatically |
| `vcmd2conf.autoRefresh` | `true` | Auto-refresh on file changes |
| `vcmd2conf.autoRefreshInterval` | `60` | Remote version check interval (seconds) |
| `vcmd2conf.excludePatterns` | `[...]` | Glob patterns to exclude |
| `vcmd2conf.showNotifications` | `true` | Show sync notifications |

### Using a mark config file

If you have a `ci.toml` for mark:
```toml
base_url = "https://your-domain.atlassian.net/wiki"
user = "you@example.com"
password = "your-api-token"
```

Set `vcmd2conf.markConfigPath` to the path of your config file.

## 🎯 Commands

| Command | Description |
|---------|-------------|
| `VcMd2Conf: Sync to Confluence` | Sync the active/selected file |
| `VcMd2Conf: Sync Folder to Confluence` | Sync all MD files in a folder |
| `VcMd2Conf: Sync All to Confluence` | Sync all modified/new files |
| `VcMd2Conf: Refresh Sync Status` | Re-scan workspace and check versions |
| `VcMd2Conf: Open in Confluence` | Open the page in browser |
| `VcMd2Conf: Check Remote Version` | Check if remote version is newer |
| `VcMd2Conf: Toggle View Mode` | Switch between folder/status views |
| `VcMd2Conf: Configure Confluence Connection` | Open the configuration screen |

## 🔧 Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Typecheck and focused tests
npm run typecheck
npm test

# Watch mode
npm run watch

# Package .vsix
npm run package
```

## 📄 License

MIT
