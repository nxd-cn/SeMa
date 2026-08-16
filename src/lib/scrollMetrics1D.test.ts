import { describe, expect, it } from "vitest";
import {
  scrollPosFromTrackPointer,
  scrollThumb1D,
} from "./scrollMetrics1D";

describe("scrollThumb1D", () => {
  it("hides when content fits", () => {
    expect(
      scrollThumb1D({ pos: 0, scrollSize: 400, clientSize: 400 }, 400)
        .visible
    ).toBe(false);
  });

  it("sizes thumb by visible ratio (vertical or horizontal)", () => {
    const t = scrollThumb1D(
      { pos: 0, scrollSize: 800, clientSize: 400 },
      400
    );
    expect(t.visible).toBe(true);
    expect(t.size).toBe(200);
    expect(t.offset).toBe(0);
  });

  it("moves thumb with scroll position", () => {
    const t = scrollThumb1D(
      { pos: 400, scrollSize: 800, clientSize: 400 },
      400
    );
    expect(t.offset).toBe(200);
  });
});

describe("scrollPosFromTrackPointer", () => {
  it("maps track center click to mid scroll", () => {
    const pos = scrollPosFromTrackPointer(
      { pos: 0, scrollSize: 800, clientSize: 400 },
      400,
      200,
      200
    );
    expect(pos).toBe(200);
  });
});
