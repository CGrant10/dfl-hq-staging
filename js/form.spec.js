import { describe, expect, it } from "vitest";
import { layoutFields } from "./form-layout.js";

/* layoutFields takes the renderer, so the spec supplies a minimal one rather
   than dragging form.js (and the database, and a CDN) into the test. */
const render = (f) => `<label><input id="${"f_"}${f.name}" name="${f.name}"></label>`;
const fieldSet = (fields, prefix = "f_", opts) =>
  layoutFields(fields, (f) => `<label><input id="${prefix}${f.name}" name="${f.name}"></label>`, opts);

const F = (name, advanced = false) => ({ name, label: name, type: "text", ...(advanced ? { advanced: true } : {}) });

describe("form field sets", () => {
  it("renders a spec with no advanced fields exactly as before", () => {
    /*
      The compatibility that makes this safe to apply app-wide: every other
      section's form must be untouched, so a spec with nothing marked produces
      no disclosure at all.
    */
    const html = fieldSet([F("a"), F("b")], "f_");
    expect(html).not.toContain("<details");
    expect(html).toContain('name="a"');
    expect(html).toContain('name="b"');
  });

  it("folds advanced fields under one disclosure and counts them", () => {
    const html = fieldSet([F("headline"), F("weight", true), F("dwell", true)], "f_");
    expect(html).toContain("<details");
    expect(html).toContain("More options");
    expect(html).toContain(">2<");                    // the count, not a guess
    /* Essentials come first in the document, so the headline is reachable
       without opening anything. */
    expect(html.indexOf('name="headline"')).toBeLessThan(html.indexOf("<details"));
  });

  it("still emits every field, so nothing becomes uneditable", () => {
    // The commissioner asked to keep editing everything. Hiding is layout;
    // dropping would be a feature removal, and readForm() reads by name.
    const names = ["treatment", "kicker", "headline", "figure", "weight", "ends_at"];
    const html = fieldSet(names.map((n, i) => F(n, i > 2)), "i_");
    for (const n of names) expect(html).toContain(`name="${n}"`);
  });

  it("uses the caller's prefix on both tiers", () => {
    const html = fieldSet([F("a"), F("b", true)], "i_");
    expect(html).toContain('id="i_a"');
    expect(html).toContain('id="i_b"');
  });

  it("survives an empty or missing field list", () => {
    expect(fieldSet([], "f_")).toBe("");
    expect(fieldSet(undefined, "f_")).toBe("");
  });
});
