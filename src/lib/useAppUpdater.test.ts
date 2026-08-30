import { describe, expect, it } from "vitest";
import { updateOfferTitle } from "./useAppUpdater";

describe("updateOfferTitle", () => {
  it("shows version when notes empty", () => {
    expect(updateOfferTitle({ version: "1.2.3", notes: "" })).toBe(
      "更新至 v1.2.3",
    );
  });

  it("strips leading v from version", () => {
    expect(updateOfferTitle({ version: "v2.0.0", notes: "" })).toBe(
      "更新至 v2.0.0",
    );
  });

  it("appends release notes", () => {
    expect(
      updateOfferTitle({ version: "1.0.1", notes: "- fix a\n- fix b" }),
    ).toBe("更新至 v1.0.1\n\n- fix a\n- fix b");
  });
});
