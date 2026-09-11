import { describe, expect, it } from "vitest";
import { selectFormValue } from "./form-value.js";

describe("select form values", () => {
  it("uses a declared default for a legacy null value", () => {
    expect(selectFormValue({ type: "select", default: "default" }, null)).toBe("default");
  });

  it("preserves an explicit selection", () => {
    expect(selectFormValue({ type: "select", default: "default" }, "faint")).toBe("faint");
  });

  it("keeps a blank selection when the field intentionally has no default", () => {
    expect(selectFormValue({ type: "select" }, null)).toBe("");
  });
});
