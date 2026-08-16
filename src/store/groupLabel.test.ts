import { describe, expect, it } from "vitest";
import { commitCustomTitle } from "../lib/commitCustomTitle";
import {
  folderName,
  groupLabel,
  paneChromeText,
  toolLabelForCli,
} from "./appStore";
import type { GroupState, PaneState } from "./types";

function pane(partial: Partial<PaneState> & { id: string }): PaneState {
  return {
    cwd: "D:/工具",
    cliId: "cursor",
    flex: 1,
    label: "x",
    canResume: false,
    ...partial,
  };
}

describe("commitCustomTitle", () => {
  it("trims and keeps non-empty", () => {
    expect(commitCustomTitle("  my tag  ")).toBe("my tag");
  });
  it("empty / whitespace → null (clear)", () => {
    expect(commitCustomTitle("")).toBeNull();
    expect(commitCustomTitle("   ")).toBeNull();
  });
});

describe("groupLabel", () => {
  const panes: Record<string, PaneState> = {
    a: pane({ id: "a", cwd: "D:/工具/SeMa", cliId: "cursor" }),
    b: pane({ id: "b", cwd: "D:/other", cliId: "claude" }),
  };

  it("defaults to first pane folder name", () => {
    const g: GroupState = { id: "g1", paneIds: ["a", "b"], focusId: "a" };
    expect(groupLabel(g, panes)).toBe("SeMa");
  });

  it("uses customTitle when set", () => {
    const g: GroupState = {
      id: "g1",
      paneIds: ["a"],
      focusId: "a",
      customTitle: "工作区",
    };
    expect(groupLabel(g, panes)).toBe("工作区");
  });

  it("ignores whitespace-only customTitle", () => {
    const g: GroupState = {
      id: "g1",
      paneIds: ["a"],
      focusId: "a",
      customTitle: "  ",
    };
    expect(groupLabel(g, panes)).toBe("SeMa");
  });
});

describe("paneChromeText", () => {
  const tools = [
    { id: "cursor", label: "Cursor Agent" },
    { id: "claude", label: "Claude Code" },
  ];

  it("uses tool display label with spaces around ·", () => {
    expect(paneChromeText("cursor", "D:\\工具", tools)).toBe(
      "Cursor Agent \u00B7 D:\\工具"
    );
  });

  it("falls back to cliId", () => {
    expect(toolLabelForCli("unknown", tools)).toBe("unknown");
    expect(paneChromeText("unknown", "/tmp/x", tools)).toBe(
      "unknown \u00B7 /tmp/x"
    );
  });
});

describe("folderName", () => {
  it("strips trailing separators", () => {
    expect(folderName("D:/工具/")).toBe("工具");
  });
});
