const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resumeArgsForId,
  listClaudeSessionIds,
  listOpencodeSessionIds,
  listSessionIds,
  pickNewestUnbound,
  pickCreatedSince,
  resumeArgsUnchecked,
  resolveResumeSelection,
  canResume,
  cursorWorkspaceHash,
  cursorWorkspaceHashes,
  cwdPathCandidates,
  listCursorSessionIds,
  listPiSessionIds,
  encodePiSessionDir,
  listCodexSessionIds,
  listGeminiSessionIds,
  codexSessionIdFromName,
  geminiProjectHashes,
  sessionIdExists,
} = require("../resume-detect");

assert.deepStrictEqual(
  resumeArgsForId("claude", "abc-123"),
  ["--resume", "abc-123"],
  "claude by-id"
);
assert.deepStrictEqual(
  resumeArgsForId("opencode", "sess-1"),
  ["--session", "sess-1"],
  "opencode by-id"
);
assert.deepStrictEqual(
  resumeArgsForId("cursor", "chat-uuid-1"),
  ["--resume", "chat-uuid-1"],
  "cursor by-id"
);
assert.deepStrictEqual(
  resumeArgsForId("pi", "019f827d-c503-75ad-838a-46d5f0b9abfe"),
  ["--session", "019f827d-c503-75ad-838a-46d5f0b9abfe"],
  "pi by-id"
);
assert.deepStrictEqual(
  resumeArgsForId("codex", "7f9f9a2e-1b3c-4c7a-9b0e-1234567890ab"),
  ["resume", "7f9f9a2e-1b3c-4c7a-9b0e-1234567890ab"],
  "codex by-id"
);
assert.deepStrictEqual(
  resumeArgsForId("gemini", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"),
  ["--resume", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
  "gemini by-id"
);
assert.deepStrictEqual(
  resumeArgsForId("terminal", "x"),
  [],
  "terminal never resumes by id"
);
assert.deepStrictEqual(
  resumeArgsForId("claude", ""),
  [],
  "empty id → no by-id args"
);
assert.deepStrictEqual(
  resumeArgsForId("claude", null),
  [],
  "null id → no by-id args"
);

assert.strictEqual(
  pickNewestUnbound(
    [
      { id: "a", mtimeMs: 3 },
      { id: "b", mtimeMs: 2 },
      { id: "c", mtimeMs: 1 },
    ],
    new Set(["a"])
  ),
  "b",
  "skip used newest"
);
assert.strictEqual(
  pickNewestUnbound([{ id: "a", mtimeMs: 1 }], new Set(["a"])),
  null,
  "all used → null"
);

// Two panes same cwd: pane1 snapshot empty; A then B appear → bind oldest new (A), not newest (B)
assert.strictEqual(
  pickCreatedSince(
    [
      { id: "B", mtimeMs: 2 },
      { id: "A", mtimeMs: 1 },
    ],
    [],
    []
  ),
  "A",
  "pane1: oldest new when two appeared"
);
// Pane2 snapshot knew A; B is the only new → B
assert.strictEqual(
  pickCreatedSince(
    [
      { id: "B", mtimeMs: 2 },
      { id: "A", mtimeMs: 1 },
    ],
    ["A"],
    []
  ),
  "B",
  "pane2: new since snapshot"
);
assert.strictEqual(
  pickCreatedSince(
    [
      { id: "B", mtimeMs: 2 },
      { id: "A", mtimeMs: 1 },
    ],
    [],
    ["A"]
  ),
  "B",
  "exclude already-bound sibling"
);
assert.strictEqual(
  pickCreatedSince([{ id: "A", mtimeMs: 1 }], ["A"], []),
  null,
  "nothing new since snapshot"
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sema-resume-"));
const home = path.join(tmp, "home");
const cwd = path.join(tmp, "proj");
fs.mkdirSync(cwd);
const projId = cwd.replace(/[^a-zA-Z0-9]/g, "-");
const projectDir = path.join(home, ".claude", "projects", projId);
fs.mkdirSync(projectDir, { recursive: true });
const older = path.join(projectDir, "old-id.jsonl");
const newer = path.join(projectDir, "new-id.jsonl");
fs.writeFileSync(older, "{}\n");
fs.writeFileSync(newer, "{}\n");
const t0 = Date.now();
fs.utimesSync(older, new Date(t0 - 10_000), new Date(t0 - 10_000));
fs.utimesSync(newer, new Date(t0), new Date(t0));

const listed = listClaudeSessionIds(cwd, home);
assert.strictEqual(listed[0].id, "new-id", "newest first");
assert.strictEqual(listed[1].id, "old-id", "older second");
assert.strictEqual(
  pickNewestUnbound(listed, new Set(["new-id"])),
  "old-id",
  "bind second pane to older when newest taken"
);

// Fallback map still works for claude without id path
const fallback = resumeArgsUnchecked("claude", cwd, home);
assert.ok(Array.isArray(fallback), "unchecked returns array");

assert.deepStrictEqual(
  listSessionIds("terminal", cwd, home),
  [],
  "terminal list empty"
);
assert.deepStrictEqual(
  listSessionIds("claude", cwd, home).map((e) => e.id),
  ["new-id", "old-id"],
  "listSessionIds dispatches claude"
);
assert.deepStrictEqual(
  listOpencodeSessionIds(cwd, home),
  [],
  "no opencode db → []"
);

// Cursor chats layout: ~/.cursor/chats/<md5(resolve(cwd))>/<sessionId>/
// Agent/IDE often create empty dirs (meta.json only) — those must NOT bind.
const cursorHash = cursorWorkspaceHash(cwd);
const cursorRoot = path.join(home, ".cursor", "chats", cursorHash);
fs.mkdirSync(path.join(cursorRoot, "cursor-old"), { recursive: true });
fs.mkdirSync(path.join(cursorRoot, "cursor-new"), { recursive: true });
fs.mkdirSync(path.join(cursorRoot, "cursor-empty"), { recursive: true });
fs.writeFileSync(path.join(cursorRoot, "cursor-empty", "meta.json"), "{}");
fs.writeFileSync(path.join(cursorRoot, "cursor-old", "store.db"), "old");
fs.writeFileSync(path.join(cursorRoot, "cursor-new", "store.db"), "new");
const tc = Date.now();
fs.utimesSync(
  path.join(cursorRoot, "cursor-old", "store.db"),
  new Date(tc - 5000),
  new Date(tc - 5000)
);
fs.utimesSync(
  path.join(cursorRoot, "cursor-new", "store.db"),
  new Date(tc),
  new Date(tc)
);
fs.utimesSync(
  path.join(cursorRoot, "cursor-empty"),
  new Date(tc + 1000),
  new Date(tc + 1000)
);
const cursorListed = listCursorSessionIds(cwd, home);
assert.strictEqual(cursorListed[0].id, "cursor-new", "cursor newest first");
assert.strictEqual(cursorListed[1].id, "cursor-old", "cursor older second");
assert.ok(
  !cursorListed.some((e) => e.id === "cursor-empty"),
  "cursor empty meta-only dir ignored"
);
assert.deepStrictEqual(
  listSessionIds("cursor", cwd, home).map((e) => e.id),
  ["cursor-new", "cursor-old"],
  "listSessionIds dispatches cursor"
);
assert.strictEqual(
  pickCreatedSince(cursorListed, ["cursor-old"], []),
  "cursor-new",
  "cursor pickCreatedSince after snapshot"
);
assert.strictEqual(
  sessionIdExists("cursor", cwd, "cursor-empty", home),
  false,
  "empty cursor id is not a real session"
);
assert.strictEqual(
  sessionIdExists("cursor", cwd, "cursor-new", home),
  true,
  "store.db cursor id exists"
);

// Pi sessions: ~/.pi/agent/sessions/<encodePiSessionDir(cwd)>/<ts>_<uuid>.jsonl
const piDir = path.join(
  home,
  ".pi",
  "agent",
  "sessions",
  encodePiSessionDir(cwd)
);
fs.mkdirSync(piDir, { recursive: true });
const piOld = path.join(
  piDir,
  "2026-07-21T02-25-08-355Z_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1.jsonl"
);
const piNew = path.join(
  piDir,
  "2026-07-21T08-00-40-430Z_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2.jsonl"
);
fs.writeFileSync(piOld, "{}\n");
fs.writeFileSync(piNew, "{}\n");
const tp = Date.now();
fs.utimesSync(piOld, new Date(tp - 8000), new Date(tp - 8000));
fs.utimesSync(piNew, new Date(tp), new Date(tp));
const piListed = listPiSessionIds(cwd, home);
assert.strictEqual(
  piListed[0].id,
  "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2",
  "pi newest first"
);
assert.strictEqual(
  piListed[1].id,
  "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  "pi older second"
);
assert.deepStrictEqual(
  listSessionIds("pi", cwd, home).map((e) => e.id),
  [
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  ],
  "listSessionIds dispatches pi"
);

// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl mentioning cwd
const codexDay = path.join(home, ".codex", "sessions", "2026", "08", "06");
fs.mkdirSync(codexDay, { recursive: true });
const codexUuidOld = "11111111-2222-3333-4444-555555555501";
const codexUuidNew = "11111111-2222-3333-4444-555555555502";
const codexOld = path.join(
  codexDay,
  `rollout-2026-08-06T10-00-00-${codexUuidOld}.jsonl`
);
const codexNew = path.join(
  codexDay,
  `rollout-2026-08-06T12-00-00-${codexUuidNew}.jsonl`
);
fs.writeFileSync(
  codexOld,
  JSON.stringify({ type: "session_meta", payload: { cwd, id: codexUuidOld } }) +
    "\n"
);
fs.writeFileSync(
  codexNew,
  JSON.stringify({ type: "session_meta", payload: { cwd, id: codexUuidNew } }) +
    "\n"
);
const tc0 = Date.now();
fs.utimesSync(codexOld, new Date(tc0 - 9000), new Date(tc0 - 9000));
fs.utimesSync(codexNew, new Date(tc0), new Date(tc0));
assert.strictEqual(
  codexSessionIdFromName(path.basename(codexNew)),
  codexUuidNew,
  "codex id from filename"
);
const codexListed = listCodexSessionIds(cwd, home);
assert.strictEqual(codexListed[0].id, codexUuidNew, "codex newest first");
assert.strictEqual(codexListed[1].id, codexUuidOld, "codex older second");
assert.deepStrictEqual(
  listSessionIds("codex", cwd, home).map((e) => e.id),
  [codexUuidNew, codexUuidOld],
  "listSessionIds dispatches codex"
);

// Gemini: ~/.gemini/tmp/<hash>/chats/<uuid>.json
const gHash = [...geminiProjectHashes(cwd)][0];
const gChats = path.join(home, ".gemini", "tmp", gHash, "chats");
fs.mkdirSync(gChats, { recursive: true });
const gOld = "aaaaaaaa-bbbb-cccc-dddd-000000000001";
const gNew = "aaaaaaaa-bbbb-cccc-dddd-000000000002";
fs.writeFileSync(path.join(gChats, `${gOld}.json`), JSON.stringify({ cwd }));
fs.writeFileSync(path.join(gChats, `${gNew}.json`), JSON.stringify({ cwd }));
const tg = Date.now();
fs.utimesSync(path.join(gChats, `${gOld}.json`), new Date(tg - 7000), new Date(tg - 7000));
fs.utimesSync(path.join(gChats, `${gNew}.json`), new Date(tg), new Date(tg));
const gemListed = listGeminiSessionIds(cwd, home);
assert.strictEqual(gemListed[0].id, gNew, "gemini newest first");
assert.strictEqual(gemListed[1].id, gOld, "gemini older second");
assert.deepStrictEqual(
  listSessionIds("gemini", cwd, home).map((e) => e.id),
  [gNew, gOld],
  "listSessionIds dispatches gemini"
);

// Two panes same cwd, no bound ids: each ↻ must get a distinct by-id target
// (not both falling through to --continue / --last).
const paneA = resolveResumeSelection("claude", cwd, {
  resume: true,
  excludeIds: [],
}, home);
assert.deepStrictEqual(
  paneA.args,
  ["--resume", "new-id"],
  "unbound pane A → newest by id"
);
assert.strictEqual(paneA.resolvedId, "new-id", "pane A resolvedId");
assert.strictEqual(paneA.usedBound, false, "pane A not bound");

const paneB = resolveResumeSelection("claude", cwd, {
  resume: true,
  excludeIds: [paneA.resolvedId],
}, home);
assert.deepStrictEqual(
  paneB.args,
  ["--resume", "old-id"],
  "unbound pane B excludes A → next by id"
);
assert.strictEqual(paneB.resolvedId, "old-id", "pane B resolvedId");

const boundOk = resolveResumeSelection("claude", cwd, {
  resume: true,
  cliSessionId: "old-id",
  excludeIds: ["new-id"],
}, home);
assert.deepStrictEqual(boundOk.args, ["--resume", "old-id"], "prefer bound id");
assert.strictEqual(boundOk.usedBound, true, "bound used");

const boundTaken = resolveResumeSelection("claude", cwd, {
  resume: true,
  cliSessionId: "new-id",
  excludeIds: ["new-id"],
}, home);
assert.deepStrictEqual(
  boundTaken.args,
  ["--resume", "old-id"],
  "bound owned by sibling → pick next unbound"
);
assert.strictEqual(boundTaken.usedBound, false, "sibling-bound not usedBound");

const noResume = resolveResumeSelection("claude", cwd, { resume: false }, home);
assert.deepStrictEqual(noResume.args, [], "create path never resumes");

// Platform-specific OpenCode fallback (no DB / no id):
// Windows keeps --continue; macOS must NOT (broken with some local DBs).
const ocEmptyCwd = path.join(tmp, "oc-empty");
fs.mkdirSync(ocEmptyCwd);
const ocFallback = resumeArgsUnchecked("opencode", ocEmptyCwd, home);
if (process.platform === "win32") {
  assert.deepStrictEqual(
    ocFallback,
    ["--continue"],
    "Windows OpenCode fallback --continue"
  );
} else {
  assert.deepStrictEqual(
    ocFallback,
    [],
    "macOS/Linux OpenCode: no --continue when id missing"
  );
}

// By-id resume argv is identical on Win and Mac (including OpenCode --session).
const ocById = resolveResumeSelection(
  "opencode",
  cwd,
  { resume: true, cliSessionId: "sess-mac-win" },
  home
);
// sessionIdExists is false without DB → falls through; force via resumeArgsForId
assert.deepStrictEqual(
  resumeArgsForId("opencode", "sess-mac-win"),
  ["--session", "sess-mac-win"],
  "OpenCode by-id same on all platforms"
);

// cwdPathCandidates includes resolve (+ realpath when different) — Mac symlink safe.
const candidates = cwdPathCandidates(cwd);
assert.ok(candidates.length >= 1, "cwdPathCandidates non-empty");
assert.ok(
  candidates.includes(path.resolve(cwd)),
  "cwdPathCandidates includes path.resolve"
);
const hashes = cursorWorkspaceHashes(cwd);
assert.ok(hashes.length >= 1, "cursorWorkspaceHashes non-empty");
assert.strictEqual(
  hashes[0],
  cursorWorkspaceHash(cwd),
  "primary cursor hash is first candidate"
);

// Cursor canResume is cwd-scoped (not “any chat under ~/.cursor”).
const otherCwd = path.join(tmp, "other-proj");
fs.mkdirSync(otherCwd);
assert.strictEqual(
  canResume("cursor", cwd, home),
  true,
  "cursor canResume for cwd with store.db chats"
);
assert.strictEqual(
  canResume("cursor", otherCwd, home),
  false,
  "cursor canResume false when this cwd has no chats"
);

console.log("ok — resume-detect");
