import { describe, expect, it } from "vitest";
import { docSaveKeyAction, docSaveShortcutLabel } from "./docSaveKeys";

describe("docSaveKeyAction", () => {
  it("matches ⌘S on Mac", () => {
    expect(
      docSaveKeyAction(
        { type: "keydown", key: "s", metaKey: true },
        { isMac: true }
      )
    ).toBe("save");
  });

  it("matches Ctrl+S on Windows", () => {
    expect(
      docSaveKeyAction(
        { type: "keydown", key: "s", ctrlKey: true },
        { isMac: false }
      )
    ).toBe("save");
  });

  it("ignores wrong modifiers", () => {
    expect(
      docSaveKeyAction(
        { type: "keydown", key: "s", metaKey: true },
        { isMac: false }
      )
    ).toBe(null);
    expect(
      docSaveKeyAction(
        { type: "keydown", key: "s", ctrlKey: true, shiftKey: true },
        { isMac: false }
      )
    ).toBe(null);
  });
});

describe("docSaveShortcutLabel", () => {
  it("labels by platform", () => {
    expect(docSaveShortcutLabel(true)).toBe("⌘S");
    expect(docSaveShortcutLabel(false)).toBe("Ctrl+S");
  });
});
