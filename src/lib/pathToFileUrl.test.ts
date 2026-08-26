import { describe, expect, it } from "vitest";
import { pathToFileUrl } from "./pathToFileUrl";

describe("pathToFileUrl", () => {
  it("encodes posix absolute paths", () => {
    expect(pathToFileUrl("/tmp/page.html")).toBe("file:///tmp/page.html");
  });

  it("encodes windows drive paths", () => {
    expect(pathToFileUrl("C:\\proj\\out\\index.html")).toBe(
      "file:///C:/proj/out/index.html",
    );
  });
});
