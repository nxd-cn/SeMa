import { describe, expect, it } from "vitest";
import { newSessionKeyAction, newSessionShortcutLabel } from "./newSessionKeys";

describe("newSessionKeyAction", () => {
  it("matches Cmd+Shift+N on macOS", () => {
    expect(
      newSessionKeyAction(
        { type: "keydown", key: "n", metaKey: true, shiftKey: true },
        { isMac: true }
      )
    ).toBe("newSession");
  });

  it("matches Ctrl+Shift+N on Windows", () => {
    expect(
      newSessionKeyAction(
        { type: "keydown", key: "n", ctrlKey: true, shiftKey: true },
        { isMac: false }
      )
    ).toBe("newSession");
  });

  it("rejects bare Ctrl/Cmd+N (avoid PTY readline / browser New)", () => {
    expect(
      newSessionKeyAction(
        { type: "keydown", key: "n", metaKey: true },
        { isMac: true }
      )
    ).toBeNull();
    expect(
      newSessionKeyAction(
        { type: "keydown", key: "n", ctrlKey: true },
        { isMac: false }
      )
    ).toBeNull();
  });

  it("rejects when wrong platform modifiers", () => {
    expect(
      newSessionKeyAction(
        { type: "keydown", key: "n", ctrlKey: true, shiftKey: true },
        { isMac: true }
      )
    ).toBeNull();
    expect(
      newSessionKeyAction(
        { type: "keydown", key: "n", metaKey: true, shiftKey: true },
        { isMac: false }
      )
    ).toBeNull();
  });

  it("labels", () => {
    expect(newSessionShortcutLabel(true)).toBe("⌘⇧N");
    expect(newSessionShortcutLabel(false)).toBe("Ctrl+Shift+N");
  });
});
