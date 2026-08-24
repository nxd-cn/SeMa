import { describe, expect, it } from "vitest";
import { artifactsKey, shouldRefreshArtifacts } from "./artifactsRefresh";

describe("shouldRefreshArtifacts", () => {
  const min = 2000;

  it("returns false when elapsed is below minInterval", () => {
    expect(shouldRefreshArtifacts(1000, 2500, min)).toBe(false);
  });

  it("returns true when elapsed equals minInterval", () => {
    expect(shouldRefreshArtifacts(1000, 3000, min)).toBe(true);
  });

  it("returns true when elapsed exceeds minInterval", () => {
    expect(shouldRefreshArtifacts(1000, 5000, min)).toBe(true);
  });

  it("allows first fetch when lastFetchMs is 0", () => {
    expect(shouldRefreshArtifacts(0, 1, min)).toBe(false);
    expect(shouldRefreshArtifacts(0, min, min)).toBe(true);
  });
});

describe("artifactsKey", () => {
  it("returns empty string for null, undefined, or empty id", () => {
    expect(artifactsKey(null)).toBe("");
    expect(artifactsKey(undefined)).toBe("");
    expect(artifactsKey("")).toBe("");
  });

  it("returns the session id when bound", () => {
    expect(artifactsKey("sess-abc")).toBe("sess-abc");
  });
});
