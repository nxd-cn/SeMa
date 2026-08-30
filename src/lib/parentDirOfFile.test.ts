import { describe, expect, it } from "vitest";
import { parentDirOfFile } from "./parentDirOfFile";

describe("parentDirOfFile", () => {
  it("returns posix parent", () => {
    expect(parentDirOfFile("/tmp/proj/docs/plan.md")).toBe("/tmp/proj/docs");
    expect(parentDirOfFile("/tmp/file.txt")).toBe("/tmp");
  });

  it("returns windows parent with backslashes", () => {
    expect(parentDirOfFile("D:\\工具\\SeMa\\plan.md")).toBe("D:\\工具\\SeMa");
    expect(parentDirOfFile("C:\\a.txt")).toBe("C:\\");
  });

  it("handles drive paths with forward slashes", () => {
    expect(parentDirOfFile("C:/proj/out/index.html")).toBe("C:/proj/out");
  });

  it("returns empty for bare names or empty", () => {
    expect(parentDirOfFile("")).toBe("");
    expect(parentDirOfFile("notes.md")).toBe("");
  });
});
