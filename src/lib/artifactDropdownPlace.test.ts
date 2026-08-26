import { describe, expect, it } from "vitest";
import { linkPreviewHoldLabel } from "./artifactDropdownPlace";

describe("linkPreviewHoldLabel", () => {
  it("uses host for https urls", () => {
    expect(linkPreviewHoldLabel("https://example.com/path")).toBe("example.com");
  });

  it("uses file basename for file urls", () => {
    expect(linkPreviewHoldLabel("file:///tmp/demo/page.html")).toBe("page.html");
  });
});
