const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const RESUME_ARGS = {
  claude: ["--continue"],
  cursor: ["--continue"],
  // opencode: resolved dynamically via latestOpencodeSessionId → --session <id>
  // (--continue is broken on some OpenCode builds with migrated local DBs)
  opencode: [],
  pi: ["--continue"],
  codex: ["resume", "--last"],
  gemini: ["--resume"],
};

/** Claude project id: abs path with non-alphanumeric → `-` */
function encodeClaudeProjectId(cwd) {
  return path.resolve(cwd || "").replace(/[^a-zA-Z0-9]/g, "-");
}

/** Pi session folder: `--` + path with `:`/`\`/`/` → `-` + `--` */
function encodePiSessionDir(cwd) {
  const encoded = path.resolve(cwd || "").replace(/[:\\/]/g, "-");
  return `--${encoded}--`;
}

function dirHasSessionFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return false;
  }
  if (entries.some((e) => e.endsWith(".jsonl"))) return true;
  const nested = path.join(dir, "sessions");
  if (!fs.existsSync(nested)) return false;
  try {
    return fs.readdirSync(nested).some((e) => e.endsWith(".jsonl"));
  } catch (_) {
    return false;
  }
}

function dirHasJsonFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir).some((e) => e.endsWith(".json"));
  } catch (_) {
    return false;
  }
}

function hasClaudeSession(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const id = encodeClaudeProjectId(cwd);
  if (!id) return false;
  const root = path.join(home, ".claude", "projects");
  if (dirHasSessionFiles(path.join(root, id))) return true;
  try {
    if (!fs.existsSync(root)) return false;
    for (const name of fs.readdirSync(root)) {
      if (name === id || name.endsWith(id) || id.endsWith(name)) {
        if (dirHasSessionFiles(path.join(root, name))) return true;
      }
    }
  } catch (_) {}
  return false;
}

function findStoreDb(dir, depth) {
  if ((depth || 0) > 3 || !dir || !fs.existsSync(dir)) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return false;
  }
  for (const name of entries) {
    const p = path.join(dir, name);
    if (name === "store.db") return true;
    try {
      if (fs.statSync(p).isDirectory() && findStoreDb(p, (depth || 0) + 1)) {
        return true;
      }
    } catch (_) {}
  }
  return false;
}

function hasCursorSessions(homeDir) {
  const home = homeDir || os.homedir();
  const roots = [
    path.join(home, ".cursor", "chats"),
    path.join(home, ".cursor", "acp-sessions"),
    path.join(home, ".config", "cursor", "chats"),
  ];
  if (roots.some((r) => findStoreDb(r, 0))) return true;
  const projects = path.join(home, ".cursor", "projects");
  if (!fs.existsSync(projects)) return false;
  try {
    for (const name of fs.readdirSync(projects)) {
      const transcripts = path.join(projects, name, "agent-transcripts");
      if (!fs.existsSync(transcripts)) continue;
      try {
        if (fs.readdirSync(transcripts).length) return true;
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

function opencodeDataRoot(homeDir) {
  const home = homeDir || os.homedir();
  const candidates = [
    path.join(home, ".local", "share", "opencode"),
    path.join(home, "Library", "Application Support", "opencode"),
  ];
  // Older Windows installs / some builds also use %APPDATA%\opencode
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) candidates.push(path.join(appData, "opencode"));
  }
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, "opencode.db"))) return root;
  }
  for (const root of candidates) {
    if (fs.existsSync(root)) return root;
  }
  return candidates[0];
}

function pathVariants(cwd) {
  const abs = path.resolve(cwd || "");
  const fwd = abs.replace(/\\/g, "/");
  const set = new Set([abs, fwd, abs.toLowerCase(), fwd.toLowerCase()]);
  return [...set];
}

function normalizeDirKey(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function openOpencodeDb(homeDir) {
  const root = opencodeDataRoot(homeDir);
  const dbPath = path.join(root, "opencode.db");
  if (!fs.existsSync(dbPath)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch (_) {
    return null;
  }
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (_) {
    return null;
  }
}

function directoryMatchKeys(cwd) {
  return [...new Set(pathVariants(cwd).map(normalizeDirKey))];
}

function hasOpencodeSession(cwd, homeDir) {
  const db = openOpencodeDb(homeDir);
  if (!db) return false;
  try {
    const keys = directoryMatchKeys(cwd);
    const stmt = db.prepare(
      "SELECT 1 AS ok FROM session WHERE lower(replace(directory, '\\', '/')) = ? LIMIT 1"
    );
    let stmtPd = null;
    try {
      stmtPd = db.prepare(
        "SELECT 1 AS ok FROM project_directory WHERE lower(replace(directory, '\\', '/')) = ? LIMIT 1"
      );
    } catch (_) {
      stmtPd = null;
    }
    for (const key of keys) {
      if (stmt.get(key) || (stmtPd && stmtPd.get(key))) return true;
    }
    return false;
  } catch (_) {
    return false;
  } finally {
    try {
      db.close();
    } catch (_) {}
  }
}

/** Latest OpenCode session id for cwd, or null. */
function latestOpencodeSessionId(cwd, homeDir) {
  const db = openOpencodeDb(homeDir);
  if (!db) return null;
  try {
    const keys = directoryMatchKeys(cwd);
    const stmt = db.prepare(
      "SELECT id FROM session WHERE lower(replace(directory, '\\', '/')) = ? ORDER BY time_updated DESC LIMIT 1"
    );
    for (const key of keys) {
      const row = stmt.get(key);
      if (row && row.id) return String(row.id);
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    try {
      db.close();
    } catch (_) {}
  }
}

function opencodeResumeArgs(cwd, homeDir) {
  const id = latestOpencodeSessionId(cwd, homeDir);
  if (id) return ["--session", id];
  // Keep prior Windows behavior when DB lookup finds no id (sqlite missing,
  // path mismatch, etc.). On Mac, prefer empty over broken --continue.
  if (process.platform === "win32") return ["--continue"];
  return [];
}

function hasPiSession(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const dir = path.join(
    home,
    ".pi",
    "agent",
    "sessions",
    encodePiSessionDir(cwd)
  );
  return dirHasSessionFiles(dir);
}

function fileMentionsCwd(filePath, variants) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").slice(0, 8000);
    return variants.some((v) => raw.includes(v));
  } catch (_) {
    return false;
  }
}

function hasCodexSession(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const root = path.join(home, ".codex", "sessions");
  if (!fs.existsSync(root)) return false;
  const variants = pathVariants(cwd);
  const walk = (dir, depth) => {
    if (depth > 4) return false;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      return false;
    }
    for (const name of entries) {
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch (_) {
        continue;
      }
      if (st.isDirectory()) {
        if (walk(p, depth + 1)) return true;
      } else if (/\.jsonl(\.zst)?$/i.test(name) && fileMentionsCwd(p, variants)) {
        return true;
      }
    }
    return false;
  };
  return walk(root, 0);
}

function geminiProjectHashes(cwd) {
  const forms = pathVariants(cwd);
  const out = new Set();
  for (const f of forms) {
    out.add(crypto.createHash("sha1").update(f).digest("hex"));
    out.add(crypto.createHash("sha256").update(f).digest("hex").slice(0, 32));
    out.add(crypto.createHash("md5").update(f).digest("hex"));
  }
  return out;
}

function hasGeminiSession(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const tmp = path.join(home, ".gemini", "tmp");
  if (!fs.existsSync(tmp)) return false;
  const variants = pathVariants(cwd);
  const hashes = geminiProjectHashes(cwd);
  let entries;
  try {
    entries = fs.readdirSync(tmp);
  } catch (_) {
    return false;
  }
  for (const name of entries) {
    const projectDir = path.join(tmp, name);
    const chats = path.join(projectDir, "chats");
    if (!dirHasJsonFiles(chats) && !dirHasSessionFiles(chats)) continue;
    if (hashes.has(name)) return true;
    const logs = path.join(projectDir, "logs.json");
    if (fs.existsSync(logs) && fileMentionsCwd(logs, variants)) return true;
    try {
      const chatFiles = fs
        .readdirSync(chats)
        .filter((f) => f.endsWith(".json"));
      for (const f of chatFiles.slice(0, 5)) {
        if (fileMentionsCwd(path.join(chats, f), variants)) return true;
      }
    } catch (_) {}
  }
  return false;
}

function supportsResume(cliId) {
  return Object.prototype.hasOwnProperty.call(RESUME_ARGS, cliId);
}

function canResume(cliId, cwd, homeDir) {
  if (cliId === "claude") return hasClaudeSession(cwd, homeDir);
  if (cliId === "cursor") return hasCursorSessions(homeDir);
  if (cliId === "opencode") return hasOpencodeSession(cwd, homeDir);
  if (cliId === "pi") return hasPiSession(cwd, homeDir);
  if (cliId === "codex") return hasCodexSession(cwd, homeDir);
  if (cliId === "gemini") return hasGeminiSession(cwd, homeDir);
  return false;
}

function resumeArgsFor(cliId, cwd, homeDir) {
  if (!supportsResume(cliId)) return [];
  if (!canResume(cliId, cwd, homeDir)) return [];
  if (cliId === "opencode") return opencodeResumeArgs(cwd, homeDir);
  return RESUME_ARGS[cliId].slice();
}

/**
 * Resume argv for known CLIs (manual「继续上次」).
 * OpenCode needs cwd to resolve `--session <id>`.
 */
function resumeArgsUnchecked(cliId, cwd, homeDir) {
  if (!supportsResume(cliId)) return [];
  if (cliId === "opencode") return opencodeResumeArgs(cwd, homeDir);
  return RESUME_ARGS[cliId].slice();
}

module.exports = {
  encodeClaudeProjectId,
  encodePiSessionDir,
  hasClaudeSession,
  hasCursorSessions,
  hasOpencodeSession,
  latestOpencodeSessionId,
  hasPiSession,
  hasCodexSession,
  hasGeminiSession,
  supportsResume,
  canResume,
  resumeArgsFor,
  resumeArgsUnchecked,
};
