import { describe, expect, it } from "vitest";
import {
  artifactsCollectReady,
  artifactsKey,
  artifactsScopeKey,
  shouldRefreshArtifacts,
} from "./artifactsRefresh";

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

describe("artifactsCollectReady", () => {
  it("is ready for resume (full history) when bound", () => {
    expect(
      artifactsCollectReady({
        cliSessionId: "s1",
        artifactsIncludeHistory: true,
      }),
    ).toBe(true);
  });

  it("waits for ↻ while resume offer is pending", () => {
    expect(
      artifactsCollectReady({
        cliSessionId: "s1",
        resumeOfferPending: true,
        artifactsIncludeHistory: false,
      }),
    ).toBe(false);
    expect(
      artifactsCollectReady({
        cliSessionId: "s1",
        resumeOfferPending: false,
        artifactsIncludeHistory: true,
      }),
    ).toBe(true);
  });

  it("waits for baseline on new chat binds", () => {
    expect(
      artifactsCollectReady({
        cliSessionId: "s1",
        artifactsIncludeHistory: false,
      }),
    ).toBe(false);
    expect(
      artifactsCollectReady({
        cliSessionId: "s1",
        artifactsIncludeHistory: false,
        artifactsSinceSeq: 4,
      }),
    ).toBe(true);
  });
});

describe("artifactsScopeKey", () => {
  it("distinguishes full history from since-bind scopes", () => {
    expect(
      artifactsScopeKey({
        cliSessionId: "s1",
        artifactsIncludeHistory: true,
      }),
    ).toBe("s1:full");
    expect(
      artifactsScopeKey({
        cliSessionId: "s1",
        artifactsSinceSeq: 2,
      }),
    ).toBe("s1:2");
  });
});
