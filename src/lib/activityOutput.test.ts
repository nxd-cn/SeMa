import { describe, expect, it } from "vitest";
import {
  looksLikeTurnOutput,
  shouldRefreshBusyTimer,
  stripTerminalControls,
} from "./activityOutput";

describe("looksLikeTurnOutput", () => {
  it("rejects empty and ANSI-only redraws", () => {
    expect(looksLikeTurnOutput("")).toBe(false);
    expect(looksLikeTurnOutput("\x1b[?25l\x1b[1A\x1b[2K")).toBe(false);
    expect(looksLikeTurnOutput("\x1b]0;title\x07")).toBe(false);
  });

  it("accepts single streamed printable chars", () => {
    expect(looksLikeTurnOutput("H")).toBe(true);
    expect(looksLikeTurnOutput("你")).toBe(true);
  });

  it("accepts newline-bearing chunks", () => {
    expect(looksLikeTurnOutput("ab\n")).toBe(true);
  });

  it("rejects bare CR (TUI cursor reset / redraw)", () => {
    expect(looksLikeTurnOutput("\r")).toBe(false);
    expect(looksLikeTurnOutput("\r\r")).toBe(false);
  });

  it("accepts CR when other printable text remains", () => {
    expect(looksLikeTurnOutput("ab\r")).toBe(true);
  });
});

describe("shouldRefreshBusyTimer", () => {
  it("when not busy, only qualifying output arms the timer", () => {
    expect(shouldRefreshBusyTimer(false, "\x1b[1A", false)).toBe(false);
    expect(shouldRefreshBusyTimer(false, "H", true)).toBe(true);
  });

  it("when busy, any non-empty chunk refreshes (keeps pulse through spinners)", () => {
    expect(shouldRefreshBusyTimer(true, "\x1b[1A\x1b[2K", false)).toBe(true);
    expect(shouldRefreshBusyTimer(true, "x", true)).toBe(true);
    expect(shouldRefreshBusyTimer(true, "", false)).toBe(false);
  });
});

describe("stripTerminalControls", () => {
  it("leaves plain text", () => {
    expect(stripTerminalControls("hello")).toBe("hello");
  });
});
