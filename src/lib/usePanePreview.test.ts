import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SPLIT_RATIO, type PanePreview } from "./panePreview";
import { DISCARD_UNSAVED_MESSAGE } from "../components/PaneDocView";
import {
  applyDocMode,
  applyDocSaveError,
  applyDocSaved,
  applyDocText,
  applyLinkLoadError,
  applySplitRatio,
  canReplacePreview,
  closePreview,
  isDocDirty,
  openDocErrorPreview,
  paneWebviewVisibleArgs,
  previewErrorMessage,
  shouldClosePaneWebviewOnChange,
  shouldForceClosePreview,
} from "./usePanePreview";

const dirtyDoc = (over: Partial<Extract<PanePreview, { kind: "doc" }>> = {}): PanePreview => ({
  kind: "doc",
  path: "/p/a.md",
  mode: "preview",
  dirty: true,
  splitRatio: 0.4,
  text: "old",
  ...over,
});

describe("isDocDirty", () => {
  it("is true only for dirty docs", () => {
    expect(isDocDirty(null)).toBe(false);
    expect(isDocDirty({ kind: "link", url: "https://ex.com", splitRatio: 0.5 })).toBe(false);
    expect(isDocDirty(dirtyDoc({ dirty: false }))).toBe(false);
    expect(isDocDirty(dirtyDoc())).toBe(true);
  });
});

describe("canReplacePreview / closePreview", () => {
  it("skips confirm when not dirty or when force-closing", () => {
    const confirmFn = vi.fn(() => false);
    expect(canReplacePreview(null, { confirm: confirmFn })).toBe(true);
    expect(
      canReplacePreview(dirtyDoc(), { force: true, confirm: confirmFn }),
    ).toBe(true);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(closePreview(dirtyDoc(), { force: true, confirm: confirmFn })).toBeNull();
  });

  it("prompts and keeps preview when dirty close is cancelled", () => {
    const prev = dirtyDoc();
    const confirmFn = vi.fn(() => false);
    expect(canReplacePreview(prev, { confirm: confirmFn })).toBe(false);
    expect(confirmFn).toHaveBeenCalledWith(DISCARD_UNSAVED_MESSAGE);
    expect(closePreview(prev, { confirm: confirmFn })).toBe(prev);
  });

  it("closes after confirm when dirty", () => {
    expect(closePreview(dirtyDoc(), { confirm: () => true })).toBeNull();
  });
});

describe("openDocErrorPreview", () => {
  it("opens a doc pane with error and keeps splitRatio", () => {
    const prev: PanePreview = {
      kind: "link",
      url: "https://ex.com",
      splitRatio: 0.62,
    };
    expect(openDocErrorPreview(prev, "/p/missing.md", "not found")).toEqual({
      kind: "doc",
      path: "/p/missing.md",
      mode: "preview",
      dirty: false,
      splitRatio: 0.62,
      text: "",
      error: "not found",
    });
  });

  it("uses default split when prev is null", () => {
    const preview = openDocErrorPreview(null, "/p/a.txt", "too large");
    expect(preview).toMatchObject({
      kind: "doc",
      path: "/p/a.txt",
      mode: "edit",
      splitRatio: DEFAULT_SPLIT_RATIO,
      error: "too large",
    });
  });
});

describe("doc / ratio patches", () => {
  it("applyDocText marks dirty and clears error", () => {
    const next = applyDocText(dirtyDoc({ dirty: false, error: "x" }), "new");
    expect(next).toMatchObject({ kind: "doc", text: "new", dirty: true });
    expect(next && next.kind === "doc" ? next.error : "keep").toBeUndefined();
  });

  it("applyDocMode / applySplitRatio / applyDocSaved ignore non-docs where needed", () => {
    const link: PanePreview = { kind: "link", url: "https://ex.com", splitRatio: 0.5 };
    expect(applyDocText(link, "x")).toBe(link);
    expect(applyDocMode(link, "edit")).toBe(link);
    expect(applyDocSaved(link)).toBe(link);
    expect(applyDocSaveError(link, "e")).toBe(link);
    expect(applySplitRatio(link, 0.3)).toEqual({ ...link, splitRatio: 0.3 });
    expect(applyDocMode(dirtyDoc(), "edit")).toMatchObject({ mode: "edit" });
    expect(applyDocSaved(dirtyDoc({ error: "e" }))).toMatchObject({
      dirty: false,
      error: undefined,
    });
    expect(applyDocSaveError(dirtyDoc(), "disk full")).toMatchObject({
      dirty: true,
      error: "disk full",
    });
  });
});

describe("shouldForceClosePreview", () => {
  it("force-closes when cliSessionId is cleared", () => {
    expect(shouldForceClosePreview(null)).toBe(true);
    expect(shouldForceClosePreview(undefined)).toBe(true);
    expect(shouldForceClosePreview("")).toBe(true);
    expect(shouldForceClosePreview("sess-1")).toBe(false);
  });
});

describe("previewErrorMessage", () => {
  it("unwraps string and Error", () => {
    expect(previewErrorMessage("not found")).toBe("not found");
    expect(previewErrorMessage(new Error("too large"))).toBe("too large");
  });
});

const linkPreview = (over: Partial<Extract<PanePreview, { kind: "link" }>> = {}): PanePreview => ({
  kind: "link",
  url: "https://ex.com",
  splitRatio: 0.5,
  ...over,
});

describe("applyLinkLoadError", () => {
  it("flags loadError on a link preview", () => {
    expect(applyLinkLoadError(linkPreview())).toMatchObject({
      kind: "link",
      url: "https://ex.com",
      loadError: true,
    });
  });

  it("ignores non-link previews", () => {
    expect(applyLinkLoadError(null)).toBeNull();
    expect(applyLinkLoadError(dirtyDoc())).toEqual(dirtyDoc());
  });
});

describe("paneWebviewVisibleArgs", () => {
  it("hides/shows only while a live link webview is open", () => {
    expect(paneWebviewVisibleArgs("p1", false, linkPreview())).toEqual({
      id: "p1",
      visible: false,
    });
    expect(paneWebviewVisibleArgs("p1", true, linkPreview())).toEqual({
      id: "p1",
      visible: true,
    });
  });

  it("skips when there is no webview (doc / closed / loadError)", () => {
    expect(paneWebviewVisibleArgs("p1", false, null)).toBeNull();
    expect(paneWebviewVisibleArgs("p1", false, dirtyDoc())).toBeNull();
    expect(
      paneWebviewVisibleArgs("p1", false, linkPreview({ loadError: true })),
    ).toBeNull();
  });
});

describe("shouldClosePaneWebviewOnChange", () => {
  it("closes when leaving a link (× or switch to doc)", () => {
    expect(shouldClosePaneWebviewOnChange(linkPreview(), null)).toBe(true);
    expect(shouldClosePaneWebviewOnChange(linkPreview(), dirtyDoc())).toBe(true);
  });

  it("keeps the webview when staying on a link", () => {
    expect(
      shouldClosePaneWebviewOnChange(
        linkPreview(),
        linkPreview({ url: "https://other.com" }),
      ),
    ).toBe(false);
    expect(shouldClosePaneWebviewOnChange(dirtyDoc(), null)).toBe(false);
  });
});
