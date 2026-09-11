import { describe, expect, it } from "vitest";
import { isNewer, updateGateMarkup } from "./update.js";

describe("app updates",()=>{
  it("compares multi-part release versions",()=>{
    expect(isNewer("1.236.2","1.218.0")).toBe(true);
    expect(isNewer("1.236.2","1.236.2")).toBe(false);
  });

  it("renders a required update without a dismiss action",()=>{
    const markup=updateGateMarkup("1.245.0");
    expect(markup).toContain("The league just got better.");
    expect(markup).toContain("UPDATE NOW");
    expect(markup).toContain("Version 1.245.0");
    expect(markup).not.toContain("<small>");
    expect(markup).not.toContain("update-no");
  });
});
