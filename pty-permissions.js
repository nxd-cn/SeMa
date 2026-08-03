const fs = require("fs");
const path = require("path");

/**
 * node-pty's Unix spawn-helper must be executable. Desktop/iCloud sync and some
 * extractors strip +x, which surfaces as `posix_spawnp failed` on session create.
 * Windows uses conpty and does not need this helper.
 */
function ensurePtySpawnHelperExecutable(nodePtyRoot) {
  if (process.platform === "win32") return { ok: true, skipped: true };

  const root =
    nodePtyRoot ||
    path.join(__dirname, "node_modules", "node-pty");
  const helper = path.join(
    root,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper"
  );

  try {
    if (!fs.existsSync(helper)) {
      return { ok: false, helper, reason: "missing" };
    }
    const st = fs.statSync(helper);
    if ((st.mode & 0o111) !== 0) {
      return { ok: true, helper, changed: false };
    }
    fs.chmodSync(helper, st.mode | 0o755);
    return { ok: true, helper, changed: true };
  } catch (err) {
    return {
      ok: false,
      helper,
      reason: err && err.message ? err.message : String(err),
    };
  }
}

module.exports = { ensurePtySpawnHelperExecutable };
