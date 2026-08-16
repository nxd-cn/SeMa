import { describe, expect, it } from "vitest";
import { createCompositionCommitDedupe } from "./xtermCapsLockIme";

describe("createCompositionCommitDedupe", () => {
  it("drops compositionend re-send after CapsLock early-finalize", () => {
    let t = 1000;
    const d = createCompositionCommitDedupe({ windowMs: 80, now: () => t });
    d.noteCompositionStart();
    t = 1100;
    expect(d.filterData("asd")).toBe("asd");
    t = 1101;
    d.noteCompositionEnd();
    t = 1102;
    expect(d.filterData("asd")).toBe(null);
  });

  it("collapses a single doubled burst after compositionstart", () => {
    const d = createCompositionCommitDedupe({ windowMs: 80, now: () => 1000 });
    d.noteCompositionStart();
    expect(d.filterData("asdasd")).toBe("asd");
  });

  it("allows normal typing outside composition", () => {
    const d = createCompositionCommitDedupe({ windowMs: 80, now: () => 1000 });
    expect(d.filterData("aa")).toBe("aa");
    expect(d.filterData("aa")).toBe("aa");
  });

  it("allows identical data after the post-composition window", () => {
    let t = 1000;
    const d = createCompositionCommitDedupe({ windowMs: 80, now: () => t });
    d.noteCompositionStart();
    expect(d.filterData("asd")).toBe("asd");
    d.noteCompositionEnd();
    t = 1200;
    expect(d.filterData("asd")).toBe("asd");
  });
});
