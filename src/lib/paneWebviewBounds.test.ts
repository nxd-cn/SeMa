import { describe, expect, it } from "vitest";
import { boundsReady, domRectToLogical, MIN_WEBVIEW_SIDE } from "./paneWebviewBounds";

function fakeRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    bottom: y + height,
    right: x + width,
    toJSON() {
      return { x, y, width, height };
    },
  } as DOMRect;
}

describe("domRectToLogical", () => {
  it("maps getBoundingClientRect CSS pixels at dpr 1", () => {
    expect(domRectToLogical(fakeRect(12, 40, 320, 200), 1)).toEqual({
      x: 12,
      y: 40,
      w: 320,
      h: 200,
    });
  });

  it("snaps to the physical pixel grid using dpr (logical output)", () => {
    // 10.25 * 2 = 20.5 → 21 physical → 10.5 logical
    expect(domRectToLogical(fakeRect(10.25, 20.4, 100.2, 50), 2)).toEqual({
      x: 10.5,
      y: 20.5,
      w: 100,
      h: 50,
    });
  });

  it("keeps Mac overlay y as-is (content already below titlebar)", () => {
    expect(domRectToLogical(fakeRect(0, 38, 400, 600), 1).y).toBe(38);
    expect(domRectToLogical(fakeRect(0, 38, 400, 600), 2).y).toBe(38);
  });

  it("clamps non-positive width/height to 0", () => {
    expect(domRectToLogical(fakeRect(8, 8, 0, -4), 1)).toMatchObject({
      w: 0,
      h: 0,
    });
  });

  it("treats invalid dpr as 1", () => {
    const rect = fakeRect(3, 5, 10, 12);
    expect(domRectToLogical(rect, 0)).toEqual({ x: 3, y: 5, w: 10, h: 12 });
    expect(domRectToLogical(rect, Number.NaN)).toEqual({
      x: 3,
      y: 5,
      w: 10,
      h: 12,
    });
  });
});

describe("boundsReady", () => {
  it("requires min side ≥ MIN_WEBVIEW_SIDE", () => {
    expect(boundsReady({ x: 0, y: 0, w: 7, h: 100 })).toBe(false);
    expect(boundsReady({ x: 0, y: 0, w: 8, h: 8 })).toBe(true);
  });
});
