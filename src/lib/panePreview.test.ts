import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT_RATIO,
  defaultDocMode,
  isHtmlPath,
  isMarkdownPath,
  openDocPreview,
  openLinkPreview,
  type PanePreview,
} from "./panePreview";

describe("isMarkdownPath", () => {
  it("detects .md and .markdown (case-insensitive)", () => {
    expect(isMarkdownPath("/proj/README.md")).toBe(true);
    expect(isMarkdownPath("notes.MD")).toBe(true);
    expect(isMarkdownPath("C:\\docs\\guide.markdown")).toBe(true);
    expect(isMarkdownPath("Guide.MARKDOWN")).toBe(true);
  });

  it("rejects non-markdown doc extensions", () => {
    expect(isMarkdownPath("/proj/readme.txt")).toBe(false);
    expect(isMarkdownPath("/proj/index.rst")).toBe(false);
    expect(isMarkdownPath("/proj/index.html")).toBe(false);
    expect(isMarkdownPath("/proj/noext")).toBe(false);
  });
});

describe("isHtmlPath", () => {
  it("detects .html and .htm (case-insensitive)", () => {
    expect(isHtmlPath("/proj/out/index.html")).toBe(true);
    expect(isHtmlPath("page.HTM")).toBe(true);
    expect(isHtmlPath("C:\\site\\home.HTML")).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isHtmlPath("/proj/readme.md")).toBe(false);
    expect(isHtmlPath("/proj/readme.txt")).toBe(false);
  });
});

describe("defaultDocMode", () => {
  it("uses preview for markdown and edit otherwise", () => {
    expect(defaultDocMode("/a.md")).toBe("preview");
    expect(defaultDocMode("/a.txt")).toBe("edit");
    expect(defaultDocMode("/a.rst")).toBe("edit");
  });
});

describe("openDocPreview", () => {
  it("opens a doc with default split ratio when prev is null", () => {
    const preview = openDocPreview(null, "/p/a.md", "# hi");
    expect(preview).toEqual({
      kind: "doc",
      path: "/p/a.md",
      mode: "preview",
      dirty: false,
      splitRatio: DEFAULT_SPLIT_RATIO,
      text: "# hi",
    });
  });

  it("keeps splitRatio from a previous doc preview", () => {
    const prev: PanePreview = {
      kind: "doc",
      path: "/old.txt",
      mode: "edit",
      dirty: true,
      splitRatio: 0.35,
      text: "old",
    };
    const preview = openDocPreview(prev, "/p/b.md", "new");
    expect(preview?.splitRatio).toBe(0.35);
    expect(preview).toMatchObject({
      kind: "doc",
      path: "/p/b.md",
      mode: "preview",
      dirty: false,
      text: "new",
    });
  });

  it("keeps splitRatio from a previous link preview", () => {
    const prev: PanePreview = {
      kind: "link",
      url: "https://ex.com",
      splitRatio: 0.62,
    };
    const preview = openDocPreview(prev, "/p/x.txt", "body");
    expect(preview?.splitRatio).toBe(0.62);
    expect(preview).toMatchObject({
      kind: "doc",
      path: "/p/x.txt",
      mode: "edit",
      dirty: false,
      text: "body",
    });
  });
});

describe("openLinkPreview", () => {
  it("opens a link with default split ratio when prev is null", () => {
    expect(openLinkPreview(null, "https://ex.com")).toEqual({
      kind: "link",
      url: "https://ex.com",
      splitRatio: DEFAULT_SPLIT_RATIO,
    });
  });

  it("keeps splitRatio from previous preview", () => {
    const prev: PanePreview = {
      kind: "doc",
      path: "/a.md",
      mode: "preview",
      dirty: false,
      splitRatio: 0.4,
      text: "",
    };
    expect(openLinkPreview(prev, "https://other.com")?.splitRatio).toBe(0.4);
  });
});
