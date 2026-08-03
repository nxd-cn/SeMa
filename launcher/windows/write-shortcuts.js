/**
 * Windows-only: write Desktop + Start Menu SeMa.lnk with AppUserModelID.
 * Invoked by install-shortcut.ps1 via local electron.exe.
 * AUMID must match main.js WINDOWS_AUMID.
 */
const { app, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const AUMID = "com.sema.app";
const repoRoot = path.join(__dirname, "..", "..");
const launcherExe = path.join(__dirname, "SeMa.exe");
const ico = path.join(__dirname, "SeMa.ico");
const electronExe = path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe");

app.whenReady().then(() => {
  try {
    if (process.platform !== "win32") {
      console.error("Windows only");
      process.exit(1);
    }
    // Prefer embedded exe icon (multi-size); fall back to SeMa.ico.
    const iconPath = fs.existsSync(launcherExe)
      ? launcherExe
      : fs.existsSync(ico)
        ? ico
        : null;
    if (!iconPath) {
      console.error("Missing icon: SeMa.exe / SeMa.ico");
      process.exit(1);
    }
    app.setAppUserModelId(AUMID);
    /** @type {import('electron').ShortcutDetails} */
    const details = {
      cwd: repoRoot,
      description: "SeMa",
      icon: iconPath,
      iconIndex: 0,
      appUserModelId: AUMID,
    };
    if (fs.existsSync(launcherExe)) {
      details.target = launcherExe;
    } else if (fs.existsSync(electronExe)) {
      details.target = electronExe;
      details.args = `"${repoRoot}"`;
    } else {
      console.error("Missing SeMa.exe and electron.exe");
      process.exit(1);
    }
    const links = [
      path.join(app.getPath("desktop"), "SeMa.lnk"),
      path.join(
        app.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "SeMa.lnk"
      ),
    ];
    for (const link of links) {
      fs.mkdirSync(path.dirname(link), { recursive: true });
      const mode = fs.existsSync(link) ? "replace" : "create";
      const ok = shell.writeShortcutLink(link, mode, details);
      if (!ok) throw new Error("writeShortcutLink failed: " + link);
      console.log("Wrote", link);
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
});
