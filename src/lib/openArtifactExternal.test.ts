import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openArtifactInBrowser,
  openArtifactInSystem,
} from "./openArtifactExternal";

vi.mock("../api/tui", () => ({
  tui: {
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => {}),
  },
}));

import { tui } from "../api/tui";

beforeEach(() => {
  vi.mocked(tui.openExternal).mockClear();
  vi.mocked(tui.openPath).mockClear();
});

describe("openArtifactInBrowser", () => {
  it("passes http links through", async () => {
    await openArtifactInBrowser("link", "https://example.com/a");
    expect(tui.openExternal).toHaveBeenCalledWith("https://example.com/a");
  });

  it("converts doc paths to file urls", async () => {
    await openArtifactInBrowser("doc", "/tmp/page.html");
    expect(tui.openExternal).toHaveBeenCalledWith("file:///tmp/page.html");
  });
});

describe("openArtifactInSystem", () => {
  it("opens links in the browser", async () => {
    await openArtifactInSystem("link", "https://example.com/a");
    expect(tui.openExternal).toHaveBeenCalledWith("https://example.com/a");
    expect(tui.openPath).not.toHaveBeenCalled();
  });

  it("opens the doc parent folder", async () => {
    await openArtifactInSystem("doc", "/tmp/proj/docs/plan.md");
    expect(tui.openPath).toHaveBeenCalledWith("/tmp/proj/docs");
    expect(tui.openExternal).not.toHaveBeenCalled();
  });
});
