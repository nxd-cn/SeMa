import { describe, expect, it, vi } from "vitest";
import { openArtifactInBrowser } from "./openArtifactExternal";

vi.mock("../api/tui", () => ({
  tui: {
    openExternal: vi.fn(async () => {}),
  },
}));

import { tui } from "../api/tui";

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
