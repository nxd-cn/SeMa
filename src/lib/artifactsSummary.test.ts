import { describe, expect, it } from "vitest";
import { artifactsSummaryLabel } from "./artifactsSummary";

describe("artifactsSummaryLabel", () => {
  it("has no 产物", () => {
    expect(artifactsSummaryLabel(2, 3)).toBe("文档 2 · 链接 3");
    expect(artifactsSummaryLabel(0, 0)).not.toContain("产物");
  });
});
