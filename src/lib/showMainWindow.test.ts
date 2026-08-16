import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const show = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ show }),
}));

describe("showMainWindowAfterPaint", () => {
  beforeEach(() => {
    show.mockClear();
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("shows after two animation frames", async () => {
    const { showMainWindowAfterPaint } = await import("./showMainWindow");
    showMainWindowAfterPaint();
    expect(show).toHaveBeenCalledTimes(1);
  });
});
