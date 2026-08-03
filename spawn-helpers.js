const { execFileSync } = require("child_process");

/**
 * Windows CreateProcess cannot run extensionless npm shims (error 193).
 * Prefer .cmd / .exe / .bat from `where` output.
 */
function pickWinExecutable(lines) {
  const list = (lines || []).map((s) => String(s).trim()).filter(Boolean);
  const preferred = list.find((p) => /\.(cmd|exe|bat)$/i.test(p));
  return preferred || list[0] || null;
}

function pickUnixExecutable(lines) {
  const list = (lines || []).map((s) => String(s).trim()).filter(Boolean);
  return list[0] || null;
}

/**
 * Resolve a CLI name on PATH. Windows: `where`; macOS/Linux: `which`.
 * @param {string} name
 * @returns {string|null}
 */
function resolveCommand(name) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where", [name], {
        encoding: "utf8",
        windowsHide: true,
      });
      return pickWinExecutable(out.split(/\r?\n/));
    }
    const out = execFileSync("which", [name], { encoding: "utf8" });
    return pickUnixExecutable(out.split(/\r?\n/));
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ path: string, command: string }} tool
 * @param {string[]} [extraArgs]
 * @returns {{ file: string, args: string[] }}
 */
function spawnTarget(tool, extraArgs) {
  const extra = Array.isArray(extraArgs) ? extraArgs.filter(Boolean) : [];
  let file = tool.path;
  let args = [];
  if (process.platform === "win32" && !/\.(exe|cmd|bat)$/i.test(file)) {
    file = process.env.COMSPEC || "cmd.exe";
    const cmdline = [tool.command, ...extra].join(" ");
    args = ["/d", "/s", "/c", cmdline];
  } else {
    args = extra.slice();
  }
  return { file, args };
}

module.exports = {
  pickWinExecutable,
  pickUnixExecutable,
  resolveCommand,
  spawnTarget,
};
