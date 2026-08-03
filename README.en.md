# SeMa

Cross-platform (**Windows / macOS**) desktop app for managing multiple AI CLI sessions in one window.

Open a project folder with Claude Code, Cursor Agent, OpenCode, Codex, Gemini, Pi, and more. Supports split panes, resume, sidebar collapse, activity pulse, and unread notifications.

## Features

- **Multi-CLI sessions**: Launch installed AI CLIs per project folder (undetected tools stay hidden)
- **Split panes**: Side-by-side sessions in a group; drag to resize
- **Top-right CLI shortcuts**: Buttons for each detected CLI above the terminal; click to open another pane in the **same folder** as the focused session, in the current group (no folder picker)
- **Drag to merge**: Drag a sidebar group tag onto another to merge all sessions from the source into the target as extra panes; different project folders are allowed, and each pane keeps its own cwd
- **Resume**: When history is found for that folder, **↻** restores the last session
- **Sidebar collapse**: Toolbar **◀ / ☰** hides the session list; terminals stay visible
- **Activity pulse**: Green pulse on the sidebar after a real reply to your message
- **Unread**: Blue unread + toast when another group gets a reply; Dock / taskbar badge
- **Layout memory**: Groups and splits are restored on quit; closing all sessions leaves a blank start next time

Sessions open **fresh** by default (no auto-resume). Transcripts stay with each CLI; SeMa does not store them.

## Requirements

- Node.js (LTS recommended)
- Windows or macOS
- AI CLIs installed and on `PATH` (install only what you need)

## Install

From the repo root:

```bash
npm install
```

`postinstall` handles `node-pty` permissions and related setup. If launch fails (native module ABI mismatch with Electron):

```bash
npx @electron/rebuild
```

That command rebuilds native modules (mainly `node-pty` here) via **node-gyp**. If rebuild fails or cannot compile, installing an npm package alone is usually not enough — you need the **system build tools** node-gyp depends on:

| Platform | What to install |
|----------|-----------------|
| macOS | Xcode Command Line Tools: `xcode-select --install` |
| Windows | [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (workload “Desktop development with C++”) and Python (used by node-gyp) |

You can also install the tool itself with `npm install -g node-gyp`, but the compilers / toolchain above must be present before re-running `npx @electron/rebuild`.

## Launch

### Command line

```bash
npm start
```

After editing the main process, **fully quit** and start again — reloading the window is not enough.

### Convenient launch (Launcher)

No need to type `npm start` every time. Run `npm install` first, then use the platform launcher.

#### macOS

| Method | Notes |
|--------|--------|
| Double-click `launcher/mac/SeMa.app` | Recommended; drag into the Dock |
| `launcher/mac/start-sema.sh` | For command-line debugging |
| `npm run build:launcher-mac` | Rebuild the `.app` after icon/template changes |

If Gatekeeper blocks the first open: right-click → **Open**, or allow it in System Settings.

#### Windows

| Method | Notes |
|--------|--------|
| Double-click `launcher/windows/SeMa.vbs` | No console window; works without building an exe |
| `launcher/windows/SeMa.exe` | Build locally first (see below) |
| `install-shortcut` | Desktop + Start Menu shortcuts |

Build a branded exe (optional):

```powershell
powershell -ExecutionPolicy Bypass -File launcher/windows/build-sema-exe.ps1
```

Or double-click `launcher/windows/build-sema-exe.bat`. Or:

```bash
npm run build:launcher-win
```

Create Desktop / Start Menu shortcuts (optional, recommended):

```powershell
powershell -ExecutionPolicy Bypass -File launcher/windows/install-shortcut.ps1
```

Or double-click `launcher/windows/install-shortcut.bat`. Then pin **SeMa** from the Start Menu or Desktop to the taskbar.

> This repo runs in development mode (`electron .`), not as a packaged installer. After moving the repo, re-run `install-shortcut`.

## Usage

1. Click **+** in the sidebar, pick a folder and a CLI.
2. **Sidebar groups**: Drag one group tag onto another to merge into a single split group (source panes append to the target; the folder name on the tag follows the target). Use pane **⤢** to split a pane back into its own session.
3. **Toolbar**
   - Left **◀ / ☰**: collapse or expand the session list
   - **Top-right CLI buttons**: detected CLIs ordered by use frequency; click to open a new pane in the **same folder** as the focused session, added to the current split group. Disabled when nothing is focused. Use sidebar **+** to pick a folder and start a new group.
4. **Pane chrome**
   - **↻**: resume when history is detected (falls back to a new session on failure)
   - **⤢**: detach the pane into its own session when the group has 2+ panes
5. **Unread**: blue dot + toast when another group replies; click the tab/toast to clear, or refocus the window while that group is active

## Data locations

| Purpose | Windows | macOS |
|---------|---------|--------|
| SeMa prefs / cache | `%APPDATA%\sema\` | `~/Library/Application Support/sema/` |
| CLI transcripts | Owned by each CLI | Same |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Prompt to run `npm install` | Install deps from the repo root |
| `npx @electron/rebuild` fails / node-gyp errors | Install the build tools first (see Install above); macOS: `xcode-select --install`; Windows: VS Build Tools (C++) + Python, then re-run rebuild |
| Windows taskbar shows Electron | Fully quit and reopen; or re-run `install-shortcut.ps1`; unpin old Electron and pin SeMa |
| Native module errors on start | Run `npx @electron/rebuild`, then restart |
| macOS `posix_spawnp failed` when opening a session | Often a missing `+x` on `node-pty`’s `spawn-helper`; restart the app (auto-fix) or run `npm install` again |
| Shortcuts break after moving the repo | Re-run `launcher/windows/install-shortcut.ps1` |

中文: [README.md](./README.md)
