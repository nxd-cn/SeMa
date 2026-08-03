const assert = require("assert");
const {
  shouldSuppressForImeComposition,
} = require("../ime-composition-keys");

// CapsLock during IME composition must be swallowed so xterm CompositionHelper
// does not early-finalize (duplicate send). Upstream: xterm.js #5282.
assert.strictEqual(
  shouldSuppressForImeComposition({ type: "keydown", key: "CapsLock", keyCode: 20 }),
  true
);
assert.strictEqual(
  shouldSuppressForImeComposition({ type: "keydown", keyCode: 20 }),
  true
);
assert.strictEqual(
  shouldSuppressForImeComposition({ type: "keydown", key: "CapsLock" }),
  true
);

// Normal keys still pass through.
assert.strictEqual(
  shouldSuppressForImeComposition({ type: "keydown", key: "a", keyCode: 65 }),
  false
);
assert.strictEqual(
  shouldSuppressForImeComposition({ type: "keydown", key: "Process", keyCode: 229 }),
  false
);
assert.strictEqual(
  shouldSuppressForImeComposition({ type: "keyup", key: "CapsLock", keyCode: 20 }),
  false
);
assert.strictEqual(shouldSuppressForImeComposition(null), false);
assert.strictEqual(shouldSuppressForImeComposition({}), false);

console.log("ok");
