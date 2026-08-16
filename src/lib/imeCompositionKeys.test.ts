import { describe, expect, it } from "vitest";
import { shouldSuppressForImeComposition } from "./imeCompositionKeys";

describe("shouldSuppressForImeComposition", () => {
  it("swallows CapsLock keydown (key + keyCode 20)", () => {
    expect(
      shouldSuppressForImeComposition({
        type: "keydown",
        key: "CapsLock",
        keyCode: 20,
      })
    ).toBe(true);
  });

  it("swallows CapsLock when only keyCode is set", () => {
    expect(
      shouldSuppressForImeComposition({ type: "keydown", keyCode: 20 })
    ).toBe(true);
  });

  it("swallows CapsLock when only key is set", () => {
    expect(
      shouldSuppressForImeComposition({ type: "keydown", key: "CapsLock" })
    ).toBe(true);
  });

  // Tauri WKWebView may report CapsLock with keyCode 0 / empty key; only code is reliable.
  it("swallows CapsLock when only code is CapsLock (WKWebView)", () => {
    expect(
      shouldSuppressForImeComposition({
        type: "keydown",
        code: "CapsLock",
        key: "",
        keyCode: 0,
      })
    ).toBe(true);
  });

  it("swallows CapsLock when key is Unidentified but code is CapsLock", () => {
    expect(
      shouldSuppressForImeComposition({
        type: "keydown",
        code: "CapsLock",
        key: "Unidentified",
        keyCode: 0,
      })
    ).toBe(true);
  });

  it("does not swallow normal letters", () => {
    expect(
      shouldSuppressForImeComposition({
        type: "keydown",
        key: "a",
        code: "KeyA",
        keyCode: 65,
      })
    ).toBe(false);
  });

  it("does not swallow IME Process key (229)", () => {
    expect(
      shouldSuppressForImeComposition({
        type: "keydown",
        key: "Process",
        keyCode: 229,
      })
    ).toBe(false);
  });

  it("does not swallow CapsLock keyup", () => {
    expect(
      shouldSuppressForImeComposition({
        type: "keyup",
        key: "CapsLock",
        code: "CapsLock",
        keyCode: 20,
      })
    ).toBe(false);
  });

  it("handles null / empty", () => {
    expect(shouldSuppressForImeComposition(null)).toBe(false);
    expect(shouldSuppressForImeComposition({})).toBe(false);
  });
});
