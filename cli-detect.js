const CATALOG = [
  { id: "claude", label: "Claude Code", candidates: ["claude"] },
  { id: "opencode", label: "OpenCode", candidates: ["opencode"] },
  { id: "cursor", label: "Cursor Agent", candidates: ["cursor-agent", "cursor"] },
  { id: "codex", label: "Codex", candidates: ["codex"] },
  { id: "gemini", label: "Gemini", candidates: ["gemini"] },
  { id: "pi", label: "Pi", candidates: ["pi"] },
];

function detectTools(resolveCommand) {
  const tools = [];
  for (const entry of CATALOG) {
    for (const name of entry.candidates) {
      const resolved = resolveCommand(name);
      if (resolved) {
        tools.push({
          id: entry.id,
          label: entry.label,
          command: name,
          path: resolved,
        });
        break;
      }
    }
  }
  return tools;
}

function toolForId(tools, cliId) {
  return tools.find((t) => t.id === cliId) || null;
}

function sortToolsByUsage(tools, counts) {
  const c = counts || {};
  return tools
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ca = c[a.t.id] || 0;
      const cb = c[b.t.id] || 0;
      if (cb !== ca) return cb - ca;
      return a.i - b.i;
    })
    .map((x) => x.t);
}

module.exports = { CATALOG, detectTools, toolForId, sortToolsByUsage };
