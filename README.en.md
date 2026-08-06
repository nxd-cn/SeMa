# SeMa

Cross-platform (**Windows / macOS**) desktop app for managing multiple AI CLI sessions in one window.

Built with Electron + xterm.js + node-pty. Open a project folder with:

- Claude Code
- Cursor Agent
- OpenCode
- Codex
- Gemini
- Pi

Supports split panes, resume, sidebar collapse, activity pulse, and unread toasts.

> Contributor conventions: [AGENTS.md](./AGENTS.md). 中文: [README.md](./README.md).

## Requirements

- Node.js (LTS recommended)
- AI CLIs installed and on `PATH` (only detected tools appear in the UI)
- Windows or macOS

## Install & run

```bash
npm install
npm start
```

### Convenient launch

See [launcher/README.md](./launcher/README.md): macOS `launcher/mac/SeMa.app` (Dock-pinnable); Windows `launcher/windows/SeMa.vbs`, plus `launcher/windows/install-shortcut.ps1` for Desktop/Start Menu shortcuts.

`postinstall` runs `electron-rebuild` so `node-pty` matches the Electron ABI. On macOS, if it still fails:

```bash
npx @electron/rebuild
```

**Note:** After editing the main process (e.g. `main.js`), fully quit the app and run `npm start` again — reloading the renderer is not enough. There is **no packaging script** yet; run via `electron .`.

## Usage

1. Click **+** in the sidebar, pick a folder and a CLI.
2. Toolbar:
   - Left **◀ / ☰**: collapse or expand the session list (terminals stay visible).
   - CLI buttons: open another pane in the focused group / cwd.
3. Pane chrome:
   - **↻**: resume last session when history is detected (falls back to a new session on failure).
   - **⤢**: detach the pane into its own session when the group has 2+ panes.
4. Other groups: unread blue dot + toast after activity; click to clear.

Sessions start **fresh** by default; resume only via **↻**.

## Data locations

| Purpose | Windows | macOS |
|---------|---------|--------|
| SeMa prefs / cache | `%APPDATA%\sema\` | `~/Library/Application Support/sema/` |
| CLI transcripts | Owned by each CLI (SeMa does not store them) | Same |

## Architecture

| Layer | Files | Role |
|-------|-------|------|
| Main | `main.js` | Window, prefs, CLI detect, PTY, IPC |
| Preload | `preload.js` | `window.tui.*` |
| Renderer | `renderer/` | Sidebar, splits, toolbar, resume / unread UI |
| Detect / Spawn / Resume | `cli-detect.js`, `spawn-helpers.js`, `resume-detect.js` | Discovery, launch, resume argv |

## Platform support

Both Windows and macOS are first-class. Fixes for one OS must **not** break the other (PATH, `where`/`which`, Windows shims, `cmd.exe`, path separators — branch by platform). See [AGENTS.md](./AGENTS.md).

## Contributing

1. Fork and branch
2. Keep diffs small; when touching detect / spawn / resume, consider both Windows and macOS
3. Open a Pull Request with a clear rationale

Design specs and plans live under `docs/superpowers/specs/` and `docs/superpowers/plans/`.
