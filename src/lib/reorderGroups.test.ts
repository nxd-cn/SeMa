import { describe, expect, it } from "vitest";
import {
  reorderGroupList,
  resolveTabDropFromTarget,
} from "./reorderGroups";

describe("resolveTabDropFromTarget", () => {
  it("merges in the middle zone", () => {
    expect(
      resolveTabDropFromTarget("a", "b", 15, 30, 1)
    ).toEqual({ kind: "merge", targetId: "b" });
  });

  it("inserts before in the top zone", () => {
    expect(
      resolveTabDropFromTarget("a", "b", 5, 30, 1)
    ).toEqual({ kind: "insert", insertBeforeIndex: 1 });
  });

  it("inserts after in the bottom zone", () => {
    expect(
      resolveTabDropFromTarget("a", "b", 26, 30, 1)
    ).toEqual({ kind: "insert", insertBeforeIndex: 2 });
  });

  it("returns none for self", () => {
    expect(
      resolveTabDropFromTarget("a", "a", 10, 30, 0)
    ).toEqual({ kind: "none" });
  });
});

describe("reorderGroupList", () => {
  const groups = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
  ];

  it("moves an item earlier in the list", () => {
    expect(reorderGroupList(groups, "c", 0)).toEqual([
      { id: "c" },
      { id: "a" },
      { id: "b" },
      { id: "d" },
    ]);
  });

  it("moves an item later in the list", () => {
    expect(reorderGroupList(groups, "a", 3)).toEqual([
      { id: "b" },
      { id: "c" },
      { id: "a" },
      { id: "d" },
    ]);
  });

  it("no-ops when dropping at the same slot", () => {
    expect(reorderGroupList(groups, "b", 1)).toBe(groups);
    expect(reorderGroupList(groups, "b", 2)).toBe(groups);
  });
});
