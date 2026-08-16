import { describe, expect, it } from "vitest";
import {
  sidebarToggleKeyAction,
  sidebarToggleShortcutLabel,
} from "./sidebarToggleKeys";

describe("sidebarToggleKeyAction", () => {
  it("matches Cmd+Shift+B on macOS", () => {
    expect(
      sidebarToggleKeyAction(
        { type: "keydown", key: "b", metaKey: true, shiftKey: true },
        { isMac: true }
      )
    ).toBe("toggleSidebar");
  });

  it("matches Ctrl+Shift+B on Windows", () => {
    expect(
      sidebarToggleKeyAction(
        { type: "keydown", key: "b", ctrlKey: true, shiftKey: true },
        { isMac: false }
      )
    ).toBe("toggleSidebar");
  });

  it("rejects bare Ctrl/Cmd+B", () => {
    expect(
      sidebarToggleKeyAction(
        { type: "keydown", key: "b", metaKey: true },
        { isMac: true }
      )
    ).toBeNull();
    expect(
      sidebarToggleKeyAction(
        { type: "keydown", key: "b", ctrlKey: true },
        { isMac: false }
      )
    ).toBeNull();
  });

  it("labels", () => {
    expect(sidebarToggleShortcutLabel(true)).toBe("⌘⇧B");
    expect(sidebarToggleShortcutLabel(false)).toBe("Ctrl+Shift+B");
  });
});
