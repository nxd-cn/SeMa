import { describe, expect, it, vi } from "vitest";
import { isMarkdownPath } from "../lib/panePreview";
import {
  confirmDiscardUnsaved,
  DISCARD_UNSAVED_MESSAGE,
  renderMarkdown,
} from "./PaneDocView";

describe("confirmDiscardUnsaved", () => {
  it("allows leaving without prompting when not dirty", () => {
    const confirmFn = vi.fn(() => false);
    expect(confirmDiscardUnsaved(false, confirmFn)).toBe(true);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("prompts and follows the confirm result when dirty", () => {
    expect(confirmDiscardUnsaved(true, () => true)).toBe(true);
    expect(confirmDiscardUnsaved(true, () => false)).toBe(false);
  });

  it("uses the discard copy", () => {
    const confirmFn = vi.fn(() => true);
    confirmDiscardUnsaved(true, confirmFn);
    expect(confirmFn).toHaveBeenCalledWith(DISCARD_UNSAVED_MESSAGE);
    expect(DISCARD_UNSAVED_MESSAGE).toBe("放弃未保存更改？");
  });
});

describe("renderMarkdown", () => {
  it("renders headings for markdown preview", () => {
    const html = renderMarkdown("# Hello");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
  });
});

describe("mode toggle visibility (defaultDocMode / isMarkdownPath)", () => {
  it("offers mode toggle only for markdown paths", () => {
    expect(isMarkdownPath("/a.md")).toBe(true);
    expect(isMarkdownPath("/a.markdown")).toBe(true);
    expect(isMarkdownPath("/a.txt")).toBe(false);
    expect(isMarkdownPath("/a.rst")).toBe(false);
  });
});
