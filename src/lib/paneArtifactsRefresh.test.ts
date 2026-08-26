import { describe, expect, it, vi } from "vitest";
import type { ArtifactsResult } from "../api/tui";
import {
  isCurrentArtifactsRequest,
  runArtifactsRefresh,
  shouldClearArtifactsLoading,
  shouldShowLoading,
} from "./paneArtifactsRefresh";

const sample: ArtifactsResult = {
  docs: [{ path: "/p/a.md", label: "a.md" }],
  links: [{ url: "https://ex.com" }],
};

const resumeScope = () => ({
  cliSessionId: "s1",
  artifactsIncludeHistory: true,
});

describe("runArtifactsRefresh", () => {
  it("returns unbound and does not fetch when cliSessionId is missing", async () => {
    const sessionArtifacts = vi.fn();
    const r = await runArtifactsRefresh({
      query: { cliId: "claude", cwd: "/p", cliSessionId: null },
      force: true,
      lastFetchMs: 0,
      nowMs: 5000,
      sessionArtifacts,
      currentBoundId: () => null,
    });
    expect(r).toEqual({ kind: "unbound" });
    expect(sessionArtifacts).not.toHaveBeenCalled();
  });

  it("treats empty string id as unbound", async () => {
    const sessionArtifacts = vi.fn();
    const r = await runArtifactsRefresh({
      query: { cliId: "claude", cwd: "/p", cliSessionId: "" },
      force: true,
      lastFetchMs: 0,
      nowMs: 2000,
      sessionArtifacts,
      currentBoundId: () => "",
    });
    expect(r).toEqual({ kind: "unbound" });
    expect(sessionArtifacts).not.toHaveBeenCalled();
  });

  it("skips fetch when not forced and under the 2000ms throttle", async () => {
    const sessionArtifacts = vi.fn();
    const r = await runArtifactsRefresh({
      query: {
        cliId: "claude",
        cwd: "/p",
        cliSessionId: "s1",
        artifactsSinceSeq: 2,
      },
      force: false,
      lastFetchMs: 1000,
      nowMs: 2500,
      sessionArtifacts,
      currentBoundId: () => "s1",
    });
    expect(r).toEqual({ kind: "throttled" });
    expect(sessionArtifacts).not.toHaveBeenCalled();
  });

  it("fetches when forced even if under the throttle window", async () => {
    const sessionArtifacts = vi.fn(async () => sample);
    const r = await runArtifactsRefresh({
      query: {
        cliId: "claude",
        cwd: "/proj",
        cliSessionId: "s1",
        artifactsSinceSeq: 3,
      },
      force: true,
      lastFetchMs: 1000,
      nowMs: 1500,
      sessionArtifacts,
      currentBoundId: () => "s1",
      currentScope: () => ({
        cliSessionId: "s1",
        artifactsSinceSeq: 3,
      }),
    });
    expect(sessionArtifacts).toHaveBeenCalledWith({
      cliId: "claude",
      cwd: "/proj",
      cliSessionId: "s1",
      sinceSeq: 3,
    });
    expect(r).toEqual({ kind: "ok", result: sample, lastFetchMs: 1500 });
  });

  it("fetches full history for resume without a baseline seq", async () => {
    const sessionArtifacts = vi.fn(async () => sample);
    const r = await runArtifactsRefresh({
      query: {
        cliId: "claude",
        cwd: "/p",
        cliSessionId: "s1",
        artifactsIncludeHistory: true,
      },
      force: true,
      lastFetchMs: 0,
      nowMs: 1000,
      sessionArtifacts,
      currentBoundId: () => "s1",
      currentScope: resumeScope,
    });
    expect(sessionArtifacts).toHaveBeenCalledWith({
      cliId: "claude",
      cwd: "/p",
      cliSessionId: "s1",
      sinceSeq: null,
    });
    expect(r).toEqual({ kind: "ok", result: sample, lastFetchMs: 1000 });
  });

  it("does not fetch before artifacts baseline is captured", async () => {
    const sessionArtifacts = vi.fn();
    const r = await runArtifactsRefresh({
      query: { cliId: "claude", cwd: "/p", cliSessionId: "s1" },
      force: true,
      lastFetchMs: 0,
      nowMs: 5000,
      sessionArtifacts,
      currentBoundId: () => "s1",
    });
    expect(r).toEqual({ kind: "no-baseline" });
    expect(sessionArtifacts).not.toHaveBeenCalled();
  });

  it("fetches a throttled idle refresh when elapsed is at least 2000ms", async () => {
    const sessionArtifacts = vi.fn(async () => sample);
    const r = await runArtifactsRefresh({
      query: {
        cliId: "cursor",
        cwd: "/p",
        cliSessionId: "s2",
        artifactsSinceSeq: 0,
      },
      force: false,
      lastFetchMs: 1000,
      nowMs: 3000,
      sessionArtifacts,
      currentBoundId: () => "s2",
      currentScope: () => ({
        cliSessionId: "s2",
        artifactsSinceSeq: 0,
      }),
    });
    expect(r).toEqual({ kind: "ok", result: sample, lastFetchMs: 3000 });
  });

  it("ignores the response when the bound id changed mid-flight", async () => {
    let bound: string | null = "s1";
    const sessionArtifacts = vi.fn(async () => {
      bound = "s2";
      return sample;
    });
    const r = await runArtifactsRefresh({
      query: {
        cliId: "claude",
        cwd: "/p",
        cliSessionId: "s1",
        artifactsSinceSeq: 1,
      },
      force: true,
      lastFetchMs: 0,
      nowMs: 2000,
      sessionArtifacts,
      currentBoundId: () => bound,
      currentScope: () => ({
        cliSessionId: bound,
        artifactsSinceSeq: 1,
      }),
    });
    expect(r).toEqual({ kind: "stale", lastFetchMs: 2000 });
  });
});

describe("shouldShowLoading", () => {
  it("does not flash loading for silent force-refresh while collapsed", () => {
    expect(shouldShowLoading(false, true)).toBe(false);
  });

  it("shows loading only when menu is open and force-refreshing", () => {
    expect(shouldShowLoading(true, true)).toBe(true);
  });

  it("does not show loading for idle refresh when menu is open", () => {
    expect(shouldShowLoading(true, false)).toBe(false);
  });
});

describe("isCurrentArtifactsRequest", () => {
  it("lets only the latest request id apply artifacts or loading", () => {
    expect(isCurrentArtifactsRequest(3, 3)).toBe(true);
    expect(isCurrentArtifactsRequest(2, 3)).toBe(false);
  });
});

describe("shouldClearArtifactsLoading", () => {
  it("clears loading for a current stale response so it cannot stick", () => {
    expect(shouldClearArtifactsLoading(true, "stale")).toBe(true);
    expect(shouldClearArtifactsLoading(true, "ok")).toBe(true);
    expect(shouldClearArtifactsLoading(true, "unbound")).toBe(true);
    expect(shouldClearArtifactsLoading(true, "no-baseline")).toBe(true);
  });

  it("does not clear loading for a superseded in-flight request", () => {
    expect(shouldClearArtifactsLoading(false, "stale")).toBe(false);
    expect(shouldClearArtifactsLoading(false, "ok")).toBe(false);
  });
});
