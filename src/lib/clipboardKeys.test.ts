import { describe, expect, it } from "vitest";
import {
  clipboardAction,
  undoAction,
  LINE_CLEAR_PAYLOAD,
  lineClearAction,
} from "./clipboardKeys";

describe("clipboardAction", () => {
  it("mac Cmd+C copies only with selection", () => {
    expect(
      clipboardAction(
        { type: "keydown", key: "c", metaKey: true },
        { hasSelection: true, isMac: true }
      )
    ).toBe("copy");
    expect(
      clipboardAction(
        { type: "keydown", key: "c", metaKey: true },
        { hasSelection: false, isMac: true }
      )
    ).toBeNull();
  });

  it("win Ctrl+V pastes", () => {
    expect(
      clipboardAction(
        { type: "keydown", key: "v", ctrlKey: true },
        { hasSelection: false, isMac: false }
      )
    ).toBe("paste");
  });
});

describe("undoAction", () => {
  it("maps Ctrl+Z on Windows only", () => {
    expect(
      undoAction(
        { type: "keydown", key: "z", ctrlKey: true },
        { isMac: false }
      )
    ).toBe("undo");
    expect(
      undoAction(
        { type: "keydown", key: "z", metaKey: true },
        { isMac: true }
      )
    ).toBeNull();
  });
});

describe("lineClear", () => {
  it("Ctrl+U", () => {
    expect(
      lineClearAction({ type: "keydown", key: "u", ctrlKey: true })
    ).toBe("clearLine");
    expect(LINE_CLEAR_PAYLOAD).toBe("\x15");
  });
});
