const assert = require("assert");
const {
  chatSubmitKeyAction,
  dataLooksLikeSubmit,
} = require("../continue-dismiss-keys");

assert.strictEqual(
  chatSubmitKeyAction({ type: "keydown", key: "Enter", keyCode: 13 }),
  "submit",
  "plain Enter (Win/Mac)"
);
assert.strictEqual(
  chatSubmitKeyAction({
    type: "keydown",
    key: "Enter",
    code: "NumpadEnter",
    keyCode: 13,
  }),
  "submit",
  "NumpadEnter"
);
assert.strictEqual(
  chatSubmitKeyAction({
    type: "keydown",
    key: "Enter",
    keyCode: 13,
    metaKey: true,
  }),
  "submit",
  "Cmd+Enter still submit (macOS CLIs)"
);
assert.strictEqual(
  chatSubmitKeyAction({
    type: "keydown",
    key: "Enter",
    keyCode: 13,
    ctrlKey: true,
  }),
  "submit",
  "Ctrl+Enter still submit"
);

assert.strictEqual(
  chatSubmitKeyAction({
    type: "keydown",
    key: "Enter",
    keyCode: 13,
    isComposing: true,
  }),
  null,
  "IME composition Enter must not dismiss (macOS pinyin)"
);
assert.strictEqual(
  chatSubmitKeyAction({ type: "keydown", key: "Enter", keyCode: 229 }),
  null,
  "IME Process keyCode 229"
);
assert.strictEqual(
  chatSubmitKeyAction({ type: "keydown", key: "a", keyCode: 65 }),
  null,
  "letter"
);
assert.strictEqual(chatSubmitKeyAction({ type: "keyup", key: "Enter" }), null);
assert.strictEqual(chatSubmitKeyAction(null), null);

assert.strictEqual(dataLooksLikeSubmit("\r"), true, "CR (common from xterm)");
assert.strictEqual(dataLooksLikeSubmit("\n"), true, "LF (mac paste)");
assert.strictEqual(dataLooksLikeSubmit("hi\r"), true);
assert.strictEqual(dataLooksLikeSubmit("hi\nthere"), true);
assert.strictEqual(dataLooksLikeSubmit("hi"), false);
assert.strictEqual(dataLooksLikeSubmit(""), false);
assert.strictEqual(dataLooksLikeSubmit(null), false);

console.log("ok — continue-dismiss-keys");
