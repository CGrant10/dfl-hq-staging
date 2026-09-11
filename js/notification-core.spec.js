import { describe, expect, it } from "vitest";
import { cleanNotificationDraft, DEFAULT_NOTIFICATION_CATEGORIES, safeNotificationUrl, timeAgo } from "./notification-core.js";

describe("notification helpers", () => {
  it("keeps app updates off by default while leaving them available", () => {
    expect(DEFAULT_NOTIFICATION_CATEGORIES).not.toContain("updates");
    expect(DEFAULT_NOTIFICATION_CATEGORIES).toContain("announcements");
  });
  it("keeps only internal notification destinations", () => {
    expect(safeNotificationUrl("#/polls?id=4")).toBe("#/polls?id=4");
    expect(safeNotificationUrl("https://bad.example")).toBe("#/home");
    expect(safeNotificationUrl("javascript:alert(1)")).toBe("#/home");
  });

  it("deduplicates valid member targets without rewarding extra junk", () => {
    expect(cleanNotificationDraft({ audience: "members", targetMemberIds: [2, "2", 4, "bad"] })).toMatchObject({
      audience: "members", targetMemberIds: [2, 4],
    });
  });

  it("uses compact relative time", () => {
    const now = new Date("2026-08-31T12:00:00Z").getTime();
    expect(timeAgo("2026-08-31T11:42:00Z", now)).toBe("18m ago");
    expect(timeAgo("2026-08-30T12:00:00Z", now)).toBe("1d ago");
  });
});
