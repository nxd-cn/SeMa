#!/usr/bin/env node
"use strict";

/**
 * Unpackaged Mac runs are still Electron.app — Cmd+Tab / Mission Control use that
 * bundle's icns + display name, not SeMa.app or app.dock.setIcon().
 * Copy SeMa's AppIcon.icns over electron.icns and rename the bundle for LS.
 * Windows: no-op (taskbar uses AUMID + SeMa.lnk / ICO).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function brandElectronMac(repoRoot) {
  if (process.platform !== "darwin") {
    return { ok: true, skipped: true };
  }

  const root = repoRoot || path.join(__dirname, "..");
  const electronApp = path.join(
    root,
    "node_modules",
    "electron",
    "dist",
    "Electron.app"
  );
  const srcIcns = path.join(
    root,
    "launcher",
    "mac",
    "SeMa.app",
    "Contents",
    "Resources",
    "AppIcon.icns"
  );
  const dstIcns = path.join(
    electronApp,
    "Contents",
    "Resources",
    "electron.icns"
  );
  const infoPlist = path.join(electronApp, "Contents", "Info.plist");

  if (!fs.existsSync(electronApp)) {
    return { ok: false, reason: "missing Electron.app" };
  }
  if (!fs.existsSync(srcIcns)) {
    return { ok: false, reason: "missing AppIcon.icns" };
  }

  let changed = false;
  try {
    fs.copyFileSync(srcIcns, dstIcns);
    changed = true;
  } catch (err) {
    return {
      ok: false,
      reason: err && err.message ? err.message : String(err),
    };
  }

  if (fs.existsSync(infoPlist)) {
    for (const [key, value] of [
      ["CFBundleName", "SeMa"],
      ["CFBundleDisplayName", "SeMa"],
    ]) {
      try {
        execFileSync("plutil", ["-replace", key, "-string", value, infoPlist], {
          stdio: "ignore",
        });
        changed = true;
      } catch (_) {
        /* older plutil / key missing — icon copy still helps */
      }
    }
  }

  try {
    const now = new Date();
    fs.utimesSync(electronApp, now, now);
  } catch (_) {}

  return { ok: true, changed, electronApp, dstIcns };
}

if (require.main === module) {
  const result = brandElectronMac();
  if (result.skipped) process.exit(0);
  if (!result.ok) {
    console.warn(`[sema] brand Electron.app skipped: ${result.reason}`);
    process.exit(0);
  }
  if (result.changed) {
    console.log(`[sema] branded ${result.electronApp} with SeMa icon/name`);
  }
}

module.exports = { brandElectronMac };
