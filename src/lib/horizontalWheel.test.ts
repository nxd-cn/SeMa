import { describe, expect, it, vi } from "vitest";
import {
  applyHorizontalWheel,
  wheelDeltaPixels,
} from "./horizontalWheel";

function fakeEl(partial: {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}): HTMLElement {
  return {
    scrollWidth: partial.scrollWidth,
    clientWidth: partial.clientWidth,
    scrollLeft: partial.scrollLeft,
  } as HTMLElement;
}

function wheel(
  partial: Partial<WheelEvent> & { deltaY?: number; deltaX?: number }
): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...partial,
  } as unknown as WheelEvent;
}

describe("wheelDeltaPixels", () => {
  it("keeps pixel deltas (Mac trackpad / many mice)", () => {
    expect(wheelDeltaPixels(40, 0, 400)).toBe(40);
  });

  it("scales LINE mode (common on Windows mice)", () => {
    expect(wheelDeltaPixels(3, 1, 400)).toBe(48);
  });

  it("scales PAGE mode", () => {
    expect(wheelDeltaPixels(1, 2, 400)).toBe(400);
  });
});

describe("applyHorizontalWheel", () => {
  it("maps vertical wheel to horizontal scroll", () => {
    const el = fakeEl({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
    const e = wheel({ deltaY: 40 });
    expect(applyHorizontalWheel(el, e)).toBe(true);
    expect(el.scrollLeft).toBe(40);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("scales Windows LINE-mode deltas", () => {
    const el = fakeEl({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
    const e = wheel({ deltaY: 3, deltaMode: 1 });
    expect(applyHorizontalWheel(el, e)).toBe(true);
    expect(el.scrollLeft).toBe(48);
  });

  it("no-ops when content fits", () => {
    const el = fakeEl({ scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
    const e = wheel({ deltaY: 40 });
    expect(applyHorizontalWheel(el, e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("prefers native horizontal delta from trackpads", () => {
    const el = fakeEl({ scrollWidth: 800, clientWidth: 400, scrollLeft: 10 });
    const e = wheel({ deltaX: 25, deltaY: 5 });
    expect(applyHorizontalWheel(el, e)).toBe(true);
    expect(el.scrollLeft).toBe(35);
  });

  it("does not steal vertical wheel from xterm", () => {
    const el = fakeEl({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
    const xterm = {
      classList: { contains: (c: string) => c === "xterm-viewport" },
      parentNode: null,
    };
    const e = wheel({ deltaY: 40, target: xterm as unknown as EventTarget });
    expect(applyHorizontalWheel(el, e)).toBe(false);
    expect(el.scrollLeft).toBe(0);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("Shift+wheel over xterm scrolls the strip (Win + Mac)", () => {
    const el = fakeEl({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
    const xterm = {
      classList: { contains: (c: string) => c === "xterm-viewport" },
      parentNode: null,
    };
    const e = wheel({
      deltaY: 40,
      shiftKey: true,
      target: xterm as unknown as EventTarget,
    });
    expect(applyHorizontalWheel(el, e)).toBe(true);
    expect(el.scrollLeft).toBe(40);
  });
});
