/**
 * Startup argv that skip workspace-trust prompts (folder 授信).
 * Only CLIs with a dedicated trust/skip-trust flag — not tool-permission
 * bypasses like --dangerously-skip-permissions / --yolo.
 * OpenCode / Pi / Claude / Codex: no reliable trust flag → empty.
 */
const TRUST_ARGS = {
  cursor: ["--trust"],
  gemini: ["--skip-trust"],
};

/**
 * @param {string} cliId
 * @returns {string[]}
 */
function trustArgsFor(cliId) {
  const args = TRUST_ARGS[cliId];
  return Array.isArray(args) ? args.slice() : [];
}

/**
 * Trust flags first, then resume/continue argv.
 * @param {string} cliId
 * @param {string[]} [resumeArgs]
 * @returns {string[]}
 */
function launchArgsFor(cliId, resumeArgs) {
  const trust = trustArgsFor(cliId);
  const resume = Array.isArray(resumeArgs) ? resumeArgs.filter(Boolean) : [];
  return trust.concat(resume);
}

module.exports = { TRUST_ARGS, trustArgsFor, launchArgsFor };
