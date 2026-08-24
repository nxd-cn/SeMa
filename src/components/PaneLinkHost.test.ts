import { describe, expect, it } from "vitest";
import {
  LINK_LOAD_ERROR_MESSAGE,
  LINK_OPEN_EXTERNAL_LABEL,
} from "./PaneLinkHost";

describe("PaneLinkHost fallback copy", () => {
  it("offers system-browser open on embed failure", () => {
    expect(LINK_OPEN_EXTERNAL_LABEL).toBe("在系统浏览器打开");
    expect(LINK_LOAD_ERROR_MESSAGE).toBe("无法在栏内打开此链接");
  });
});
