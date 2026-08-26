import { describe, expect, it } from "vitest";
import { DEFAULT_SPLIT_RATIO, type PanePreview } from "../lib/panePreview";
import {
  clampSplitRatio,
  previewHeaderTitle,
  splitRatioFromPointer,
} from "./PaneSplitBody";

describe("clampSplitRatio", () => {
  it("clamps to [0.25, 0.75]", () => {
    expect(clampSplitRatio(0)).toBe(0.25);
    expect(clampSplitRatio(0.24)).toBe(0.25);
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(0.75)).toBe(0.75);
    expect(clampSplitRatio(0.76)).toBe(0.75);
    expect(clampSplitRatio(1)).toBe(0.75);
  });

  it("falls back to default for non-finite values", () => {
    expect(clampSplitRatio(Number.NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLIT_RATIO);
  });
});

describe("splitRatioFromPointer", () => {
  it("maps pointer x to terminal share and clamps", () => {
    expect(splitRatioFromPointer(0, 0, 400)).toBe(0.25);
    expect(splitRatioFromPointer(200, 0, 400)).toBe(0.5);
    expect(splitRatioFromPointer(400, 0, 400)).toBe(0.75);
  });

  it("uses default when container width is not positive", () => {
    expect(splitRatioFromPointer(10, 0, 0)).toBe(DEFAULT_SPLIT_RATIO);
  });
});

describe("previewHeaderTitle", () => {
  it("uses the doc basename on posix and windows paths", () => {
    const posix: Exclude<PanePreview, null> = {
      kind: "doc",
      path: "/proj/docs/README.md",
      mode: "preview",
      dirty: false,
      splitRatio: 0.5,
      text: "",
    };
    const win: Exclude<PanePreview, null> = {
      ...posix,
      path: "C:\\proj\\notes.txt",
      mode: "edit",
    };
    expect(previewHeaderTitle(posix)).toBe("README.md");
    expect(previewHeaderTitle(win)).toBe("notes.txt");
  });

  it("uses the link url", () => {
    expect(
      previewHeaderTitle({
        kind: "link",
        url: "https://example.com/a",
        splitRatio: 0.5,
      })
    ).toBe("https://example.com/a");
  });

  it("uses basename for local html file urls", () => {
    expect(
      previewHeaderTitle({
        kind: "link",
        url: "file:///tmp/out/report.html",
        splitRatio: 0.5,
      })
    ).toBe("report.html");
  });
});
