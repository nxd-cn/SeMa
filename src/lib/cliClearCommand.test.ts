import { describe, expect, it } from "vitest";
import {
  looksLikeCliClearSubmit,
  pushCliClearBuffer,
} from "./cliClearCommand";

describe("cliClearCommand", () => {
  it("detects /clear submitted with CR", () => {
    let buf = "";
    for (const ch of "/clear") buf = pushCliClearBuffer(buf, ch);
    expect(looksLikeCliClearSubmit(buf)).toBe(false);
    buf = pushCliClearBuffer(buf, "\r");
    expect(looksLikeCliClearSubmit(buf)).toBe(true);
  });

  it("detects /new and /reset", () => {
    expect(looksLikeCliClearSubmit("/new\n")).toBe(true);
    expect(looksLikeCliClearSubmit("hello /reset\r")).toBe(true);
  });

  it("ignores ordinary submits", () => {
    expect(looksLikeCliClearSubmit("hello\r")).toBe(false);
    expect(looksLikeCliClearSubmit("/compact\r")).toBe(false);
  });
});
