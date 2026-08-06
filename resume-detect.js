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

/**
 * Resolved cwd paths to probe for on-disk session stores.
 * On macOS, CLIs often key by realpath (`/var` → `/private/var`); Windows
 * typically has resolve === realpath — extra candidate is a no-op.
 * @param {string} cwd
 * @returns {string[]}
 */
function cwdPathCandidates(cwd) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const s = String(p || "");
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  let abs = "";
  try {
    abs = path.resolve(cwd || "");
    add(abs);
  } catch (_) {
    return out;
  }
  try {
    add(fs.realpathSync(abs));
  } catch (_) {}
  return out;
}

/** @param {string} cwd @returns {string[]} */
function claudeProjectIds(cwd) {
  return [
    ...new Set(
      cwdPathCandidates(cwd)
        .map((p) => p.replace(/[^a-zA-Z0-9]/g, "-"))
        .filter(Boolean)
    ),
  ];
}

/** Pi session folder: `--` + path with `:`/`\`/`/` → `-` + `--` */
function encodePiSessionDir(cwd) {
  const encoded = path.resolve(cwd || "").replace(/[:\\/]/g, "-");
  return `--${encoded}--`;
}

/** @param {string} cwd @returns {string[]} */
function piSessionDirNames(cwd) {
  return [
    ...new Set(
      cwdPathCandidates(cwd).map((p) => {
        const encoded = String(p).replace(/[:\\/]/g, "-");
        return `--${encoded}--`;
      })
    ),
  ];
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
  const ids = claudeProjectIds(cwd);
  if (!ids.length) return false;
  const root = path.join(home, ".claude", "projects");
  for (const id of ids) {
    if (dirHasSessionFiles(path.join(root, id))) return true;
  }
  try {
    if (!fs.existsSync(root)) return false;
    for (const name of fs.readdirSync(root)) {
      if (ids.some((id) => name === id || name.endsWith(id) || id.endsWith(name))) {
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
  const set = new Set();
  for (const abs of cwdPathCandidates(cwd)) {
    const fwd = abs.replace(/\\/g, "/");
    // JSONL/JSON often escapes backslashes (C:\\Users\\...)
    const esc = abs.replace(/\\/g, "\\\\");
    for (const v of [
      abs,
      fwd,
      esc,
      abs.toLowerCase(),
      fwd.toLowerCase(),
      esc.toLowerCase(),
    ]) {
      set.add(v);
    }
  }
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
  for (const name of piSessionDirNames(cwd)) {
    const dir = path.join(home, ".pi", "agent", "sessions", name);
    if (dirHasSessionFiles(dir)) return true;
  }
  return false;
}

/**
 * Pi session files: ~/.pi/agent/sessions/<encoded-cwd>/
 *   2026-07-21T02-25-08-355Z_<uuid>.jsonl
 * @returns {{ id: string, mtimeMs: number }[]}
 */
function listPiSessionIds(cwd, homeDir) {
  const home = homeDir || os.homedir();
  /** @type {{ id: string, mtimeMs: number }[]} */
  const out = [];
  const seen = new Set();
  const scan = (folder) => {
    if (!folder || !fs.existsSync(folder)) return;
    let entries;
    try {
      entries = fs.readdirSync(folder);
    } catch (_) {
      return;
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      const base = name.slice(0, -".jsonl".length);
      const m = base.match(
        /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
      );
      const sid = m ? m[1] : base;
      if (!sid || seen.has(sid)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(folder, name)).mtimeMs;
      } catch (_) {}
      seen.add(sid);
      out.push({ id: sid, mtimeMs });
    }
  };
  for (const name of piSessionDirNames(cwd)) {
    const dir = path.join(home, ".pi", "agent", "sessions", name);
    scan(dir);
    scan(path.join(dir, "sessions"));
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
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
  return listCodexSessionIds(cwd, homeDir).length > 0;
}

/** Extract UUIDv7 from rollout-<ts>-<uuid>.jsonl (last 5 dash segments). */
function codexSessionIdFromName(name) {
  const base = String(name || "")
    .replace(/\.jsonl(\.zst)?$/i, "");
  const parts = base.split("-");
  if (parts.length < 5) return base || null;
  return parts.slice(-5).join("-");
}

/**
 * Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-…-<uuid>.jsonl
 * Scoped by session_meta cwd (fileMentionsCwd on first chunk).
 */
function listCodexSessionIds(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const root = path.join(home, ".codex", "sessions");
  if (!fs.existsSync(root)) return [];
  const variants = pathVariants(cwd);
  /** @type {{ id: string, mtimeMs: number }[]} */
  const out = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      return;
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
        walk(p, depth + 1);
        continue;
      }
      if (!/\.jsonl(\.zst)?$/i.test(name)) continue;
      if (!fileMentionsCwd(p, variants)) continue;
      const sid = codexSessionIdFromName(name);
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      out.push({ id: sid, mtimeMs: st.mtimeMs });
    }
  };
  walk(root, 0);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
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
  return listGeminiSessionIds(cwd, homeDir).length > 0;
}

function geminiProjectChatDirs(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const tmp = path.join(home, ".gemini", "tmp");
  if (!fs.existsSync(tmp)) return [];
  const variants = pathVariants(cwd);
  const hashes = geminiProjectHashes(cwd);
  /** @type {string[]} */
  const dirs = [];
  let entries;
  try {
    entries = fs.readdirSync(tmp);
  } catch (_) {
    return [];
  }
  for (const name of entries) {
    const projectDir = path.join(tmp, name);
    const chats = path.join(projectDir, "chats");
    if (!fs.existsSync(chats)) continue;
    let matched = hashes.has(name);
    if (!matched) {
      const logs = path.join(projectDir, "logs.json");
      if (fs.existsSync(logs) && fileMentionsCwd(logs, variants)) matched = true;
    }
    if (!matched) {
      try {
        const chatFiles = fs
          .readdirSync(chats)
          .filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"));
        for (const f of chatFiles.slice(0, 8)) {
          if (fileMentionsCwd(path.join(chats, f), variants)) {
            matched = true;
            break;
          }
        }
      } catch (_) {}
    }
    if (matched) dirs.push(chats);
  }
  return dirs;
}

/**
 * Gemini: ~/.gemini/tmp/<project_hash>/chats/<session>.json
 * Resume: gemini --resume <uuid>
 */
function listGeminiSessionIds(cwd, homeDir) {
  /** @type {{ id: string, mtimeMs: number }[]} */
  const out = [];
  const seen = new Set();
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const chats of geminiProjectChatDirs(cwd, homeDir)) {
    let entries;
    try {
      entries = fs.readdirSync(chats);
    } catch (_) {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".json") && !name.endsWith(".jsonl")) continue;
      const p = path.join(chats, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch (_) {
        continue;
      }
      if (!st.isFile()) continue;
      let sid = name.replace(/\.jsonl?$/i, "");
      // session-<uuid>.json → uuid
      const m = sid.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
      );
      if (m) sid = m[1];
      if (!uuidRe.test(sid)) {
        // Try sessionId inside JSON
        try {
          const raw = fs.readFileSync(p, "utf8").slice(0, 4000);
          const jm = raw.match(
            /"sessionId"\s*:\s*"([0-9a-f-]{36})"/i
          ) || raw.match(/"id"\s*:\s*"([0-9a-f-]{36})"/i);
          if (jm) sid = jm[1];
        } catch (_) {}
      }
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      out.push({ id: sid, mtimeMs: st.mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function supportsResume(cliId) {
  return Object.prototype.hasOwnProperty.call(RESUME_ARGS, cliId);
}

function canResume(cliId, cwd, homeDir) {
  if (cliId === "claude") return hasClaudeSession(cwd, homeDir);
  // Cursor chats are per workspace hash — do not use global ~/.cursor presence.
  if (cliId === "cursor") return listCursorSessionIds(cwd, homeDir).length > 0;
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

function resumeArgsForId(cliId, cliSessionId) {
  const id = cliSessionId != null ? String(cliSessionId).trim() : "";
  if (!id) return [];
  if (cliId === "claude") return ["--resume", id];
  if (cliId === "cursor") return ["--resume", id];
  if (cliId === "pi") return ["--session", id];
  if (cliId === "opencode") return ["--session", id];
  if (cliId === "codex") return ["resume", id];
  if (cliId === "gemini") return ["--resume", id];
  return [];
}

/**
 * Choose resume argv for ↻ / respawn.
 * Prefer bound id; else newest session not in excludeIds (sibling panes);
 * only then fall back to last-in-cwd flags (may collide across unbound panes).
 *
 * @returns {{ args: string[], resolvedId: string|null, usedBound: boolean }}
 */
function resolveResumeSelection(cliId, cwd, opts, homeDir) {
  const wantResume = !!(opts && opts.resume);
  if (!wantResume) {
    return { args: [], resolvedId: null, usedBound: false };
  }

  const exclude = new Set();
  if (Array.isArray(opts && opts.excludeIds)) {
    for (const id of opts.excludeIds) {
      if (id != null && String(id).trim()) exclude.add(String(id).trim());
    }
  }
  if (Array.isArray(opts && opts.claimedIds)) {
    for (const id of opts.claimedIds) {
      if (id != null && String(id).trim()) exclude.add(String(id).trim());
    }
  }

  const bound =
    opts && opts.cliSessionId != null ? String(opts.cliSessionId).trim() : "";
  if (
    bound &&
    !exclude.has(bound) &&
    sessionIdExists(cliId, cwd, bound, homeDir)
  ) {
    const byId = resumeArgsForId(cliId, bound);
    if (byId.length) {
      return { args: byId, resolvedId: bound, usedBound: true };
    }
  }

  const picked = pickNewestUnbound(
    listSessionIds(cliId, cwd, homeDir),
    exclude
  );
  if (picked) {
    const byId = resumeArgsForId(cliId, picked);
    if (byId.length) {
      return { args: byId, resolvedId: picked, usedBound: false };
    }
  }

  return {
    args: resumeArgsUnchecked(cliId, cwd, homeDir),
    resolvedId: null,
    usedBound: false,
  };
}

/** MD5 of path.resolve(cwd) — matches ~/.cursor/chats/<hash>/ layout. */
function cursorWorkspaceHash(cwd) {
  const hashes = cursorWorkspaceHashes(cwd);
  return hashes[0] || "";
}

/** All workspace hashes to probe (resolve + realpath) for Cursor chats. */
function cursorWorkspaceHashes(cwd) {
  return [
    ...new Set(
      cwdPathCandidates(cwd).map((p) =>
        crypto.createHash("md5").update(p).digest("hex")
      )
    ),
  ];
}

function listCursorSessionIds(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const hashes = cursorWorkspaceHashes(cwd);
  if (!hashes.length) return [];
  const roots = [];
  for (const hash of hashes) {
    roots.push(path.join(home, ".cursor", "chats", hash));
    roots.push(path.join(home, ".config", "cursor", "chats", hash));
  }
  /** @type {{ id: string, mtimeMs: number }[]} */
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch (_) {
      continue;
    }
    for (const name of entries) {
      if (!name || seen.has(name)) continue;
      const p = path.join(root, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch (_) {
        continue;
      }
      if (!st.isDirectory()) continue;
      // Cursor often creates empty chat shells (meta.json only) on spawn /
      // create-chat. Binding those makes ↻ restore a blank/old session.
      const store = path.join(p, "store.db");
      if (!fs.existsSync(store)) continue;
      let mtimeMs = st.mtimeMs;
      try {
        mtimeMs = fs.statSync(store).mtimeMs;
      } catch (_) {}
      seen.add(name);
      out.push({ id: name, mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * Pre-create an empty Cursor chat and return its id (for --resume <id>).
 * @param {string} cwd
 * @param {string} [agentPath] resolved cursor-agent / agent executable
 * @returns {string|null}
 */
function createCursorChatId(cwd, agentPath) {
  const { execFileSync } = require("child_process");
  const file =
    agentPath ||
    (() => {
      try {
        const { resolveCommand } = require("./spawn-helpers");
        return (
          resolveCommand("cursor-agent") ||
          resolveCommand("agent") ||
          null
        );
      } catch (_) {
        return null;
      }
    })();
  if (!file) return null;
  const absCwd = path.resolve(cwd || "");
  try {
    let out;
    if (process.platform === "win32") {
      const comspec = process.env.COMSPEC || "cmd.exe";
      // Do not wrap path in quotes here — cmd /c "\"path\" create-chat" breaks.
      out = execFileSync(comspec, ["/d", "/s", "/c", `${file} create-chat`], {
        cwd: absCwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
      });
    } else {
      out = execFileSync(file, ["create-chat"], {
        cwd: absCwd,
        encoding: "utf8",
        timeout: 20000,
      });
    }
    const m = String(out || "")
      .trim()
      .match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      );
    return m ? m[0] : null;
  } catch (_) {
    return null;
  }
}

function listClaudeSessionIds(cwd, homeDir) {
  const home = homeDir || os.homedir();
  const ids = claudeProjectIds(cwd);
  if (!ids.length) return [];
  const root = path.join(home, ".claude", "projects");
  const dirs = [];
  const seenDir = new Set();
  for (const id of ids) {
    const primary = path.join(root, id);
    if (fs.existsSync(primary) && !seenDir.has(primary)) {
      seenDir.add(primary);
      dirs.push(primary);
    }
  }
  try {
    if (fs.existsSync(root)) {
      for (const name of fs.readdirSync(root)) {
        if (ids.some((id) => name === id)) continue;
        if (ids.some((id) => name.endsWith(id) || id.endsWith(name))) {
          const p = path.join(root, name);
          if (!seenDir.has(p)) {
            seenDir.add(p);
            dirs.push(p);
          }
        }
      }
    }
  } catch (_) {}
  /** @type {{ id: string, mtimeMs: number }[]} */
  const out = [];
  const seen = new Set();
  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      const sid = name.slice(0, -".jsonl".length);
      if (!sid || seen.has(sid)) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs;
      } catch (_) {}
      seen.add(sid);
      out.push({ id: sid, mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * @param {{ id: string, mtimeMs: number }[]} entries newest-first
 * @param {Set<string>|string[]} usedIds
 */
function pickNewestUnbound(entries, usedIds) {
  const used =
    usedIds instanceof Set
      ? usedIds
      : new Set(Array.isArray(usedIds) ? usedIds.filter(Boolean) : []);
  for (const e of entries || []) {
    if (e && e.id && !used.has(e.id)) return e.id;
  }
  return null;
}

/**
 * Bind the session *this pane* created: among ids that did not exist at spawn
 * (and are not claimed by other panes), pick the **oldest** new one.
 * Using newest-unbound is wrong when a later pane creates a newer session
 * while the earlier pane is still discovering — both would bind to the latest.
 *
 * @param {{ id: string, mtimeMs: number }[]} entries newest-first
 * @param {Set<string>|string[]} knownBefore ids present before this pane spawned
 * @param {Set<string>|string[]} [excludeIds] ids already bound to other panes
 * @returns {string|null}
 */
function pickCreatedSince(entries, knownBefore, excludeIds) {
  const known =
    knownBefore instanceof Set
      ? knownBefore
      : new Set(
          Array.isArray(knownBefore) ? knownBefore.filter(Boolean).map(String) : []
        );
  const exclude =
    excludeIds instanceof Set
      ? excludeIds
      : new Set(
          Array.isArray(excludeIds) ? excludeIds.filter(Boolean).map(String) : []
        );
  /** @type {{ id: string, mtimeMs: number }[]} */
  const created = [];
  for (const e of entries || []) {
    if (!e || !e.id) continue;
    if (known.has(e.id)) continue;
    if (exclude.has(e.id)) continue;
    created.push(e);
  }
  if (!created.length) return null;
  // entries are newest-first → last candidate is the oldest new session
  return created[created.length - 1].id;
}

function listOpencodeSessionIds(cwd, homeDir) {
  const db = openOpencodeDb(homeDir);
  if (!db) return [];
  try {
    const keys = directoryMatchKeys(cwd);
    const stmt = db.prepare(
      "SELECT id, time_updated FROM session WHERE lower(replace(directory, '\\', '/')) = ? ORDER BY time_updated DESC"
    );
    /** @type {{ id: string, mtimeMs: number }[]} */
    const out = [];
    const seen = new Set();
    for (const key of keys) {
      let rows;
      try {
        rows = stmt.all(key);
      } catch (_) {
        rows = [];
      }
      for (const row of rows || []) {
        if (!row || !row.id || seen.has(row.id)) continue;
        seen.add(row.id);
        out.push({
          id: String(row.id),
          mtimeMs: Number(row.time_updated) || 0,
        });
      }
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  } catch (_) {
    return [];
  } finally {
    try {
      db.close();
    } catch (_) {}
  }
}

function listSessionIds(cliId, cwd, homeDir) {
  if (cliId === "claude") return listClaudeSessionIds(cwd, homeDir);
  if (cliId === "cursor") return listCursorSessionIds(cwd, homeDir);
  if (cliId === "pi") return listPiSessionIds(cwd, homeDir);
  if (cliId === "opencode") return listOpencodeSessionIds(cwd, homeDir);
  if (cliId === "codex") return listCodexSessionIds(cwd, homeDir);
  if (cliId === "gemini") return listGeminiSessionIds(cwd, homeDir);
  return [];
}

/** True if this id is still a real on-disk session for cwd (not an empty shell). */
function sessionIdExists(cliId, cwd, cliSessionId, homeDir) {
  const id = cliSessionId != null ? String(cliSessionId).trim() : "";
  if (!id) return false;
  return listSessionIds(cliId, cwd, homeDir).some((e) => e && e.id === id);
}

module.exports = {
  encodeClaudeProjectId,
  encodePiSessionDir,
  cwdPathCandidates,
  cursorWorkspaceHash,
  cursorWorkspaceHashes,
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
  resumeArgsForId,
  resolveResumeSelection,
  listClaudeSessionIds,
  listCursorSessionIds,
  listPiSessionIds,
  listOpencodeSessionIds,
  listCodexSessionIds,
  listGeminiSessionIds,
  listSessionIds,
  sessionIdExists,
  createCursorChatId,
  pickNewestUnbound,
  pickCreatedSince,
  codexSessionIdFromName,
  geminiProjectHashes,
};
