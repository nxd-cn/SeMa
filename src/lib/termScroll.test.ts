import { describe, expect, it, vi } from "vitest";
import {
  captureTermScroll,
  restoreTermScroll,
  termOwnsFocus,
} from "./termScroll";

describe("captureTermScroll", () => {
  it("marks atBottom when viewport is at baseY", () => {
    expect(captureTermScroll({ viewportY: 40, baseY: 40 })).toEqual({
      viewportY: 40,
      atBottom: true,
    });
  });

  it("marks not atBottom when scrolled up", () => {
    expect(captureTermScroll({ viewportY: 10, baseY: 40 })).toEqual({
      viewportY: 10,
      atBottom: false,
    });
  });
});

describe("restoreTermScroll", () => {
  it("scrolls to bottom when snap was at bottom", () => {
    const term = {
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
    };
    restoreTermScroll(term, { viewportY: 40, atBottom: true });
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
    expect(term.scrollToLine).not.toHaveBeenCalled();
  });

  it("restores viewportY when scrolled up", () => {
    const term = {
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
    };
    restoreTermScroll(term, { viewportY: 12, atBottom: false });
    expect(term.scrollToLine).toHaveBeenCalledWith(12);
    expect(term.scrollToBottom).not.toHaveBeenCalled();
  });
});

describe("termOwnsFocus", () => {
  it("is true only when activeElement is the textarea", () => {
    const ta = { id: "ta" };
    const other = { id: "other" };
    expect(termOwnsFocus(ta as unknown as Element, ta as unknown as Element)).toBe(
      true
    );
    expect(
      termOwnsFocus(ta as unknown as Element, other as unknown as Element)
    ).toBe(false);
    expect(termOwnsFocus(null, ta as unknown as Element)).toBe(false);
  });
});
