import { describe, expect, it } from "vitest";
import { manualTickerItems } from "./ticker-lines.js";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const at = (h) => new Date(NOW + h * 3600000).toISOString();
const row = (o = {}) => ({ text: "A line", active: true, ...o });

describe("hand-written ticker lines", () => {
  it("keeps the order the query returned, which is weight order", () => {
    const out = manualTickerItems([row({ text: "first" }), row({ text: "second" })], NOW);
    expect(out.map((i) => i.text)).toEqual(["first", "second"]);
  });

  it("labels an unlabelled line rather than leaving a blank chip", () => {
    expect(manualTickerItems([row()], NOW)[0].label).toBe("DFL");
    expect(manualTickerItems([row({ label: "Reminder" })], NOW)[0].label).toBe("Reminder");
  });

  it("emits a route only when there is one", () => {
    expect(manualTickerItems([row()], NOW)[0].route).toBeUndefined();
    expect(manualTickerItems([row({ route: "golf" })], NOW)[0].route).toBe("golf");
  });

  it("drops a line with nothing to say, or switched off", () => {
    expect(manualTickerItems([row({ text: "" })], NOW)).toHaveLength(0);
    expect(manualTickerItems([row({ text: null })], NOW)).toHaveLength(0);
    expect(manualTickerItems([row({ active: false })], NOW)).toHaveLength(0);
    expect(manualTickerItems([null], NOW)).toHaveLength(0);
    expect(manualTickerItems(null, NOW)).toHaveLength(0);
  });

  it("honours a showing window at both ends", () => {
    expect(manualTickerItems([row({ starts_at: at(1) })], NOW)).toHaveLength(0);   // not yet
    expect(manualTickerItems([row({ starts_at: at(-1) })], NOW)).toHaveLength(1);  // started
    expect(manualTickerItems([row({ ends_at: at(-1) })], NOW)).toHaveLength(0);    // over
    expect(manualTickerItems([row({ ends_at: at(1) })], NOW)).toHaveLength(1);     // still on
    expect(manualTickerItems([row({ starts_at: at(-1), ends_at: at(1) })], NOW)).toHaveLength(1);
    expect(manualTickerItems([row()], NOW)).toHaveLength(1);                        // no window
  });

  it("treats an unparseable date as no bound, not as a hidden line", () => {
    /* A typo in a date must not silently retire a line for ever - the failure
       should be visible on screen, not a disappearance. */
    expect(manualTickerItems([row({ starts_at: "not a date" })], NOW)).toHaveLength(1);
    expect(manualTickerItems([row({ ends_at: "whenever" })], NOW)).toHaveLength(1);
  });
});
