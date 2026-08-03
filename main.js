const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { ensurePtySpawnHelperExecutable } = require("./pty-permissions");
const pty = require("node-pty");
const { detectTools, toolForId, sortToolsByUsage } = require("./cli-detect");
const { resolveCommand, spawnTarget } = require("./spawn-helpers");
const { resumeArgsUnchecked, canResume } = require("./resume-detect");
const { launchArgsFor } = require("./trust-args");
const { clampBadgeCount, badgeDescription } = require("./badge-count");
const { overlayPngForCount } = require("./badge-overlay");

/** Must match Start Menu / Desktop shortcut AppUserModelID (Windows taskbar identity). */
const WINDOWS_AUMID = "com.sema.app";

// Unpackaged runs are electron.exe — set identity before any window so the taskbar
// does not stick to Electron's default name/icon.
if (process.platform === "win32") {
  app.setName("SeMa");
  app.setAppUserModelId(WINDOWS_AUMID);
} else {
  app.setName("SeMa");
  // Finder / Dock launches have a minimal PATH; keep common CLI install dirs.
  enrichPathForGuiLaunch();
  ensurePtySpawnHelperExecutable();
}

/**
 * Prepend user/Homebrew bin dirs missing from GUI launch PATH (macOS/Linux only).
 * Does not change Windows PATH / spawn behavior.
 */
function enrichPathForGuiLaunch() {
  const home = os.homedir();
  const extras = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
  ];
  const parts = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  const seen = new Set(parts);
  const prepend = [];
  for (const dir of extras) {
    if (!seen.has(dir) && fs.existsSync(dir)) {
      prepend.push(dir);
      seen.add(dir);
    }
  }
  if (prepend.length) {
    process.env.PATH = prepend.concat(parts).join(path.delimiter);
  }
}

/** @type {Map<string, import('node-pty').IPty>} */
const sessions = new Map();
/** @type {Set<string>} */
const replacingIds = new Set();
let seq = 0;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {Array<{ id: string, label: string, command: string, path: string }>} */
let cachedTools = [];

function userDataFile(name) {
  return path.join(app.getPath("userData"), name);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function loadPrefs() {
  return readJson(userDataFile("prefs.json"), {
    sidebarWidth: 160,
    sidebarCollapsed: false,
    last: null,
    cliCounts: {},
    split: null,
    layout: null,
  });
}

function savePrefs(prefs) {
  writeJson(userDataFile("prefs.json"), prefs);
}

function refreshCliCache() {
  cachedTools = detectTools(resolveCommand);
  writeJson(userDataFile("cli-cache.json"), {
    detectedAt: new Date().toISOString(),
    tools: cachedTools,
  });
  return cachedTools;
}

function appIconPath() {
  // Mac: rounded plate + transparent margin (assets/icon-mac.png). Windows: full square.
  if (process.platform === "darwin") {
    const mac = path.join(__dirname, "assets", "icon-mac.png");
    if (fs.existsSync(mac)) return mac;
  }
  const png = path.join(__dirname, "assets", "icon.png");
  return fs.existsSync(png) ? png : undefined;
}

function windowsIconPath() {
  const ico = path.join(__dirname, "launcher", "windows", "SeMa.ico");
  if (fs.existsSync(ico)) return ico;
  return appIconPath();
}

/** @returns {import('electron').NativeImage | null} */
function loadWindowsTrayImage(iconPath) {
  if (!iconPath) return null;
  try {
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty() && iconPath !== appIconPath()) {
      const png = appIconPath();
      if (png) image = nativeImage.createFromPath(png);
    }
    if (image.isEmpty()) return null;
    // Tray prefers a small bitmap; oversized ICO frames can fail intermittently.
    const size = image.getSize();
    if (size.width > 32 || size.height > 32) {
      image = image.resize({ width: 16, height: 16 });
    }
    return image.isEmpty() ? null : image;
  } catch (_) {
    return null;
  }
}

function setupWindowsTray(iconPath) {
  if (process.platform !== "win32" || tray) return;
  const image = loadWindowsTrayImage(iconPath);
  if (!image) return;
  try {
    tray = new Tray(image);
    tray.setToolTip("SeMa");
    tray.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });
  } catch (_) {
    tray = null;
  }
}

/**
 * Windows taskbar name/icon come from a Start Menu shortcut whose AppUserModelID
 * matches the running process. Without it, unpackaged electron.exe shows as Electron.
 */
function ensureWindowsAppShortcut() {
  if (process.platform !== "win32") return;
  const programs = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs"
  );
  const shortcutPath = path.join(programs, "SeMa.lnk");
  const launcherExe = path.join(__dirname, "launcher", "windows", "SeMa.exe");
  // Prefer embedded multi-size icon in SeMa.exe for taskbar; else SeMa.ico / PNG.
  const icon = fs.existsSync(launcherExe)
    ? launcherExe
    : windowsIconPath();
  if (!icon) return;
  /** @type {import('electron').ShortcutDetails} */
  const details = {
    cwd: __dirname,
    description: "SeMa",
    icon,
    iconIndex: 0,
    appUserModelId: WINDOWS_AUMID,
  };
  if (fs.existsSync(launcherExe)) {
    details.target = launcherExe;
  } else {
    details.target = process.execPath;
    details.args = `"${__dirname}"`;
  }
  try {
    fs.mkdirSync(programs, { recursive: true });
    const mode = fs.existsSync(shortcutPath) ? "replace" : "create";
    shell.writeShortcutLink(shortcutPath, mode, details);
  } catch (_) {}
}

function clearWindowsJumpList() {
  if (process.platform !== "win32") return;
  try {
    app.setUserTasks([]);
  } catch (_) {}
  try {
    app.setJumpList([]);
  } catch (_) {}
}

function setupAppMenu() {
  // Keep Edit Undo/Redo out of the menu so Ctrl/Cmd+Z reaches the terminal.
  // Windows key handler remaps Ctrl+Z → readline undo \\x1f (not raw \\x1a EOF).
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        { role: "windowMenu" },
      ])
    );
    return;
  }
  Menu.setApplicationMenu(null);
}

function createWindow() {
  const icon = process.platform === "win32" ? windowsIconPath() : appIconPath();
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    title: "SeMa",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow preload to require local helpers (e.g. clipboard-keys).
      sandbox: false,
    },
  });
  // Dock setIcon needs a loadable bitmap (PNG). .icns throws and would abort
  // createWindow before loadFile → white window. Cmd+Tab uses branded Electron.app.
  if (process.platform === "darwin" && icon && app.dock) {
    try {
      app.dock.setIcon(icon);
    } catch (_) {}
  }
  if (process.platform === "win32" && icon) {
    mainWindow.setIcon(icon);
    // Re-apply after show — Windows sometimes keeps electron.exe icon until then.
    mainWindow.once("ready-to-show", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setIcon(icon);
    });
  }
  setupAppMenu();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  // win32 overlay clear needs a live window; `closed` is too late (destroyed).
  mainWindow.on("close", () => {
    applyBadge(0);
  });
  mainWindow.on("closed", () => {
    applyBadge(0);
    mainWindow = null;
  });
}

function applyBadge(count) {
  const n = clampBadgeCount(count);
  if (process.platform === "darwin") {
    try {
      app.setBadgeCount(n);
    } catch (_) {}
    return;
  }
  if (process.platform === "win32") {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (n <= 0) {
        mainWindow.setOverlayIcon(null, "");
      } else {
        const png = overlayPngForCount(n);
        const img = nativeImage.createFromBuffer(png);
        mainWindow.setOverlayIcon(img, badgeDescription(n));
      }
    } catch (_) {}
    return;
  }
  try {
    app.setBadgeCount(n);
  } catch (_) {}
}

function killAll() {
  for (const [id, proc] of sessions) {
    try {
      proc.kill();
    } catch (_) {}
    sessions.delete(id);
  }
}

function folderName(cwd) {
  const base = path.basename(cwd || "");
  return base || "home";
}

ipcMain.handle("badge:set", async (_evt, payload) => {
  const count =
    payload && typeof payload === "object" && "count" in payload
      ? payload.count
      : payload;
  applyBadge(count);
  return { ok: true };
});

ipcMain.handle("cli:list", async () => {
  const prefs = loadPrefs();
  return { tools: sortToolsByUsage(cachedTools, prefs.cliCounts || {}) };
});

ipcMain.handle("prefs:get", async () => ({
  ...loadPrefs(),
  homeDir: os.homedir(),
}));

ipcMain.handle("prefs:set", async (_evt, partial) => {
  const prefs = loadPrefs();
  if (partial && Object.prototype.hasOwnProperty.call(partial, "sidebarWidth")) {
    prefs.sidebarWidth = partial.sidebarWidth;
  }
  if (
    partial &&
    Object.prototype.hasOwnProperty.call(partial, "sidebarCollapsed")
  ) {
    prefs.sidebarCollapsed = !!partial.sidebarCollapsed;
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, "last")) {
    prefs.last = partial.last;
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, "split")) {
    prefs.split = partial.split;
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, "layout")) {
    prefs.layout = partial.layout;
  }
  savePrefs(prefs);
  return { ...prefs, homeDir: os.homedir() };
});

ipcMain.handle("dialog:pickFolder", async () => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle("window:focus", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.focus();
  } catch (_) {}
  return { ok: true };
});

ipcMain.handle("session:create", async (_evt, opts) => {
  const cwd = (opts && opts.cwd) || os.homedir();
  const cliId = (opts && opts.cliId) || (cachedTools[0] && cachedTools[0].id);
  if (!cliId) {
    throw new Error("未检测到可用 CLI");
  }
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`目录不存在: ${cwd}`);
  }
  const tool = toolForId(cachedTools, cliId);
  if (!tool) {
    throw new Error(`未找到 CLI: ${cliId}`);
  }
  const id = `s-${++seq}`;
  const label = `${tool.command} · ${folderName(cwd)}`;
  const wantResume = !!(opts && opts.resume);
  const resumeArgs = wantResume ? resumeArgsUnchecked(cliId, cwd) : [];
  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };

  function bindPty(proc, allowResumeFallback) {
    sessions.set(id, proc);
    proc.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("session:data", { id, data });
      }
    });
    proc.onExit(({ exitCode }) => {
      if (replacingIds.has(id)) return;
      const current = sessions.get(id);
      if (current !== proc) return;
      if (allowResumeFallback) {
        try {
          const plain = spawnTarget(tool, launchArgsFor(cliId, []));
          const retry = pty.spawn(plain.file, plain.args, {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd,
            env,
          });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("session:data", {
              id,
              data: "\r\n[SeMa] 续聊失败，已打开新会话。\r\n",
            });
          }
          bindPty(retry, false);
          return;
        } catch (_) {
          /* fall through */
        }
      }
      sessions.delete(id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("session:exit", {
          id,
          exitCode: exitCode ?? 0,
        });
      }
    });
  }

  try {
    const first = spawnTarget(tool, launchArgsFor(cliId, resumeArgs));
    const proc = pty.spawn(first.file, first.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env,
    });
    bindPty(proc, resumeArgs.length > 0);
    const prefs = loadPrefs();
    prefs.last = { cwd, cliId };
    prefs.cliCounts = prefs.cliCounts || {};
    prefs.cliCounts[cliId] = (prefs.cliCounts[cliId] || 0) + 1;
    savePrefs(prefs);
    return {
      id,
      label,
      canResume: canResume(cliId, cwd) && !wantResume,
    };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    throw new Error(`无法启动会话: ${message}`);
  }
});

ipcMain.handle("session:respawn", async (_evt, opts) => {
  const id = opts && opts.id;
  const cwd = (opts && opts.cwd) || os.homedir();
  const cliId = opts && opts.cliId;
  if (!id) throw new Error("缺少会话 id");
  if (!cliId) throw new Error("缺少 CLI");
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`目录不存在: ${cwd}`);
  }
  const tool = toolForId(cachedTools, cliId);
  if (!tool) throw new Error(`未找到 CLI: ${cliId}`);

  const wantResume = !!(opts && opts.resume);
  const resumeArgs = wantResume ? resumeArgsUnchecked(cliId, cwd) : [];

  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };

  replacingIds.add(id);
  const old = sessions.get(id);
  if (old) {
    sessions.delete(id);
    try {
      old.kill();
    } catch (_) {}
  }

  function attach(proc, allowResumeFallback) {
    sessions.set(id, proc);
    proc.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("session:data", { id, data });
      }
    });
    proc.onExit(({ exitCode }) => {
      if (replacingIds.has(id)) return;
      const current = sessions.get(id);
      if (current !== proc) return;
      if (allowResumeFallback) {
        try {
          const plain = spawnTarget(tool, launchArgsFor(cliId, []));
          const retry = pty.spawn(plain.file, plain.args, {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd,
            env,
          });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("session:data", {
              id,
              data: "\r\n[SeMa] 续聊失败，已打开新会话。\r\n",
            });
          }
          attach(retry, false);
          return;
        } catch (_) {
          /* fall through */
        }
      }
      sessions.delete(id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("session:exit", {
          id,
          exitCode: exitCode ?? 0,
        });
      }
    });
  }

  try {
    const target = spawnTarget(tool, launchArgsFor(cliId, resumeArgs));
    const proc = pty.spawn(target.file, target.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env,
    });
    attach(proc, resumeArgs.length > 0);
    return { ok: true };
  } catch (err) {
    if (resumeArgs.length) {
      try {
        const plain = spawnTarget(tool, launchArgsFor(cliId, []));
        const proc = pty.spawn(plain.file, plain.args, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd,
          env,
        });
        attach(proc, false);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("session:data", {
            id,
            data: "\r\n[SeMa] 续聊失败，已打开新会话。\r\n",
          });
        }
        return { ok: true, fallback: true };
      } catch (_) {
        /* fall through */
      }
    }
    const message = err && err.message ? err.message : String(err);
    throw new Error(`无法启动会话: ${message}`);
  } finally {
    setTimeout(() => replacingIds.delete(id), 800);
  }
});

ipcMain.handle("session:kill", async (_evt, id) => {
  const proc = sessions.get(id);
  if (!proc) return;
  sessions.delete(id);
  try {
    proc.kill();
  } catch (_) {}
});

ipcMain.on("session:write", (_evt, id, data) => {
  const proc = sessions.get(id);
  if (proc) proc.write(data);
});

ipcMain.on("session:resize", (_evt, id, cols, rows) => {
  const proc = sessions.get(id);
  if (!proc) return;
  const c = cols | 0;
  const r = rows | 0;
  // Match renderer MIN_FIT_* — tiny grids reflow scrollback into 1-char lines.
  if (c < 20 || r < 5) return;
  try {
    proc.resize(c, r);
  } catch (_) {}
});

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId(WINDOWS_AUMID);
    ensureWindowsAppShortcut();
    clearWindowsJumpList();
  }
  setupWindowsTray(windowsIconPath());
  createWindow();
  refreshCliCache();
});

app.on("window-all-closed", () => {
  killAll();
  app.quit();
});

app.on("before-quit", () => {
  applyBadge(0);
  if (tray) {
    tray.destroy();
    tray = null;
  }
  killAll();
});
