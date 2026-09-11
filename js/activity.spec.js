import { describe, expect, it } from "vitest";
import { activityLine, whenText, activityCard } from "./activity.js";
const NOW = Date.parse("2026-08-19T12:00:00Z");
const at = (mins) => new Date(NOW - mins * 60000).toISOString();

describe("activity feed lines", () => {
  it("folds a batch into one countable sentence", () => {
    const l = activityLine({ entity: "keepers", label: "keeper", action: "update",
      member_id: 3, display_name: "Grant", row_count: 12, last_at: at(2) }, { now: NOW });
    expect(l.who).toBe("Grant");
    expect(l.text).toBe("changed 12 keepers");
  });

  it("says 'a thing' for a single row and does not double a plural", () => {
    expect(activityLine({ entity: "polls", label: "poll", action: "insert", row_count: 1,
      last_at: at(1) }, { now: NOW }).text).toBe("added a poll");
    expect(activityLine({ entity: "keeper_rules", label: "keeper rules", action: "update",
      row_count: 3, last_at: at(1) }, { now: NOW }).text).toBe("changed 3 keeper rules");
  });

  it("reads as a sentence for a table it has never heard of", () => {
    const l = activityLine({ entity: "some_new_table", action: "insert", row_count: 1,
      last_at: at(1) }, { now: NOW });
    expect(l.text).toBe("added a some new table");
    expect(l.who).toBe("Somebody");
  });

  it("degrades time only as far as it is honest", () => {
    expect(whenText(at(0.2), NOW)).toBe("just now");
    expect(whenText(at(5), NOW)).toBe("5 min ago");
    expect(whenText(at(180), NOW)).toBe("3 hr ago");
    expect(whenText(at(60 * 24), NOW)).toBe("yesterday");
    expect(whenText(at(60 * 24 * 4), NOW)).toBe("4 days ago");
    expect(whenText(at(60 * 24 * 90), NOW)).toMatch(/[A-Z][a-z]{2}/);
    expect(whenText("not a date", NOW)).toBe("");
  });

  /* The Wall used to be mounted from inside activityCard, so this asserted
     that an empty feed still emitted its slot. pages/home.js owns that
     placement now, and the feed's job is only the feed: nothing to report
     means no section, not an empty card with somebody else's mount in it. */
  it("draws nothing at all when there is no activity to report", () => {
    expect(activityCard(null)).toBe("");
    expect(activityCard([])).toBe("");
    expect(activityCard(null)).not.toContain("data-wall-slot");
  });

  it("leaves the wall to whoever placed it", () => {
    const card = activityCard([{ entity: "polls", label: "poll vote", action: "insert",
      member_id: 7, display_name: "Grant", row_count: 1, last_at: at(3) }]);
    expect(card).toContain("act-row");
    expect(card).not.toContain("data-wall-slot");
  });

  it("hides commissioner/admin writes and keeps member activity", () => {
    const commissionerOnly = activityCard([{ entity: "keepers", label: "keeper", action: "update",
      member_id: 7, display_name: "Grant", as_commissioner: true, row_count: 1, last_at: at(3) }]);
    expect(commissionerOnly).not.toContain('href="#/profile?id=7"');
    expect(commissionerOnly).not.toContain("act-badge");

    const member = activityCard([{ entity: "polls", label: "poll vote", action: "insert",
      member_id: 7, display_name: "Grant", as_commissioner: false, row_count: 1, last_at: at(3) }]);
    expect(member).toContain('href="#/profile?id=7"');
    expect(member).toContain("Grant");
  });
});
