# SeMa

Cross-platform (**Windows / macOS**) desktop app for managing multiple AI CLI sessions in one window.

Built with **Tauri 2 + Rust + React/TypeScript + xterm.js + portable-pty**. Open a project folder with:

- Claude Code
- Cursor Agent
- OpenCode
- Codex
- Gemini
- Pi
- Kimi Code
- Terminal

Supports split panes, resume, sidebar collapse, activity pulse, unread toasts, and a read-only Git branch footer.

> Contributor conventions: [AGENTS.md](./AGENTS.md). 中文: [README.md](./README.md).

## Requirements

- Node.js (LTS recommended)
- Rust (stable + Cargo) — see [https://rustup.rs](https://rustup.rs)
- AI CLIs installed and on `PATH` (only detected tools appear in the UI); **Terminal** is always available
- Optional: `git` on PATH (pane footer shows the current branch; otherwise `~`)
- Windows or macOS ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for packaging)

## Install & run

```bash
npm install
npm run tauri:dev
```

### Package installers

```bash
npm run tauri:build
```

Artifacts land under `src-tauri/target/release/bundle/` (macOS `.app`/`.dmg`; Windows NSIS when built on Windows).

### macOS: “App is damaged and can’t be opened”

GitHub Release macOS builds are **unsigned / not notarized**. Gatekeeper may show “damaged” — that is quarantine, not a corrupt file.

After dragging `SeMa.app` into Applications, run:

```bash
xattr -cr /Applications/SeMa.app
```

Then open SeMa. Proper public distribution needs an Apple Developer ID signature and notarization.

### Auto-update

Installed SeMa checks GitHub Releases on launch. If a newer version exists, a download icon appears at the bottom of the sidebar; click to download, install, and relaunch (no uninstall). If the check fails, a refresh icon there lets you retry.

Release CI needs these repository Secrets (private key is `.tauri/sema.key` locally — never commit it):

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Full contents of `.tauri/sema.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password if the key has one; otherwise omit or leave empty |

Push a `v*` tag (e.g. `git tag v1.2.3 && git push origin v1.2.3`) so CI signs updater artifacts and uploads `latest.json`. Ordinary branch pushes do not start a release build.

## Usage

### New session & sidebar

1. **New session**: click **+**, pick a folder and a CLI.  
   - macOS: **+** lives in the overlay title bar (same row as traffic lights)  
   - Windows: **+** is at the top of the sidebar  
2. **Collapse sidebar**: ◀ / ☰ (title bar on Mac; content toolbar on Windows).  
3. **CLI quick buttons**: open another pane in the focused group / cwd (disabled when there are no panes).  
4. **Reorder tabs**: drag a tab to the **top or bottom edge** of another tab to reorder; order is saved and restored on next launch.  
5. **Merge panes**: drop a tab on the **middle** of another tab to merge into one split group.  
6. **Rename tab**: double-click a sidebar tab to edit its label; clear the field to restore the folder name.  
7. **Terminal**: always listed as **Terminal** in the CLI picker (no shell name in the label). Spawns `cmd` via `%COMSPEC%` on Windows, or `$SHELL` (fallback zsh/bash) on macOS. No resume, no ↻.

### Shortcuts (only while SeMa is the focused window)

| Action | macOS | Windows |
|--------|--------|---------|
| New session | `⌘⇧N` | `Ctrl+Shift+N` |
| Toggle sidebar | `⌘⇧B` | `Ctrl+Shift+B` |

Not global OS hotkeys — inactive when SeMa is in the background.

### Pane chrome

- Top: cwd path; **↻** resume when history exists; **⤢** detach when split; **×** close.  
- Bottom: read-only Git branch (icon + name, or `~`). No branch switching in SeMa.  
- Unread groups: blue dot + toast.

Sessions open as **new chats** by default (no auto-resume).

### macOS title bar & green button

- Overlay title bar aligned with traffic lights; sidebar shows tabs only.  
- Green button: fill the screen and auto-hide menu bar/Dock while keeping traffic lights in the title bar; click again to restore the previous window frame (not Spaces fullscreen, which would hide the lights until the cursor hits the top edge).

## Data directories

| Purpose | Windows | macOS |
|---------|---------|--------|
| SeMa prefs / cache | `%APPDATA%\com.sema.app\` | `~/Library/Application Support/com.sema.app/` |
| CLI transcripts | Owned by each CLI (SeMa does not store them) | same |

## Architecture

| Layer | Path | Role |
|-------|------|------|
| UI | `src/` | React shell, title/toolbar, branch footer, xterm |
| API | `src/api/tui.ts` | Tauri invoke / events |
| Rust | `src-tauri/` | PTY, detect, resume, git branch, prefs, bundling |

Icons live under `src-tauri/icons/`. Regenerate with `npx tauri icon <source>`, then drop Store/mobile extras before commit.

## Platform notes

Both Windows and macOS must keep working; isolate OS-specific paths. See [AGENTS.md](./AGENTS.md).
