import { describe, expect, it } from "vitest";
import {
  hexToRgb, rgbToHex, luminance, contrast, rgbToHsl, hslToRgb,
  liftForText, ensureFill, inkOn, teamPalette, PALETTE_KEYS,
} from "./team-theme.js";
import { nflTeams } from "./nfl-teams.js";

const CARD = "#141416";      // the palette's card surface
const TEXT_BAR = 6;          // the ratio theme.js holds text to
const FILL_BAR = 1.85;       // a fill only has to be seen

describe("colour maths", () => {
  it("round-trips hex through rgb and hsl", () => {
    for (const hex of ["#000000", "#ffffff", "#E5011B", "#0B162A", "#FFB612"]) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex.toLowerCase());
      const back = rgbToHex(hslToRgb(rgbToHsl(hexToRgb(hex))));
      /* HSL is lossy at 8 bits, so allow a channel to be off by one. */
      const a = hexToRgb(hex), b = hexToRgb(back);
      for (const ch of ["r", "g", "b"]) expect(Math.abs(a[ch] - b[ch])).toBeLessThanOrEqual(1);
    }
  });

  it("rejects anything that is not a colour", () => {
    for (const bad of ["", null, undefined, "red", "#12", "#1234567", "nope"]) {
      expect(hexToRgb(bad)).toBeNull();
    }
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });   // short form
  });

  it("agrees with the known WCAG anchors", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("picks the ink that can actually be read on a fill", () => {
    expect(inkOn("#FFB612")).toBe("#0A0A0A");   // Steelers gold: needs black
    expect(inkOn("#0B162A")).toBe("#FFFFFF");   // Bears navy: needs white
    expect(contrast(inkOn("#008E97"), "#008E97")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("lifting a colour until it can be read", () => {
  it("leaves a colour that already clears the bar alone", () => {
    /* The Steelers' gold is 10.5:1 on this card. Touching it would make the
       palette less like the club for no benefit. */
    expect(liftForText("#FFB612", CARD, TEXT_BAR)).toBe("#ffb612");
  });

  it("lifts a near-black primary into something legible", () => {
    /* The case that killed using raw team colours: nine clubs' primary is
       effectively black on a black ground. */
    for (const hex of ["#101820", "#0B162A", "#041E42", "#002244", "#03202F"]) {
      expect(contrast(hex, CARD)).toBeLessThan(1.5);          // unusable raw
      expect(contrast(liftForText(hex, CARD, TEXT_BAR), CARD))
        .toBeGreaterThanOrEqual(TEXT_BAR);                    // usable lifted
    }
  });

  it("keeps the hue, so a club still looks like itself", () => {
    const hue = (h) => rgbToHsl(hexToRgb(h)).h;
    for (const hex of ["#0B162A", "#4F2683", "#008E97", "#A71930"]) {
      const gap = Math.abs(hue(liftForText(hex, CARD, TEXT_BAR)) - hue(hex));
      expect(Math.min(gap, 1 - gap), `${hex} drifted hue`).toBeLessThan(0.02);
    }
  });

  it("does not return grey for a desaturated navy", () => {
    /* Lifting lightness alone turns the Bears' navy into grey, which is not
       the Bears. The lift adds saturation as it climbs. */
    const lifted = liftForText("#0B162A", CARD, TEXT_BAR);
    expect(rgbToHsl(hexToRgb(lifted)).s).toBeGreaterThan(0.2);
  });

  it("gives a fill an edge against the card without repainting it", () => {
    /* A fill keeps the club's true colour when it can be seen at all. */
    expect(ensureFill("#E31837", CARD)).toBe("#e31837");
    /* And is lifted only when it would vanish into the card. */
    expect(contrast(ensureFill("#101820", CARD), CARD)).toBeGreaterThanOrEqual(FILL_BAR);
  });

  it("returns null rather than a broken colour", () => {
    expect(liftForText("nope", CARD)).toBeNull();
    expect(ensureFill(null, CARD)).toBeNull();
  });
});

describe("every one of the 32 clubs produces a usable palette", () => {
  const clubs = nflTeams();

  it("has all 32", () => expect(clubs).toHaveLength(32));

  it("defines every value theme.js will read", () => {
    for (const t of clubs) {
      const p = teamPalette(t);
      for (const key of PALETTE_KEYS) {
        expect(p[key], `${t.code} is missing ${key}`).toBeDefined();
      }
    }
  });

  it("clears the text bar for both accents", () => {
    for (const t of clubs) {
      const p = teamPalette(t);
      expect(contrast(p.accent, CARD), `${t.code} accent`).toBeGreaterThanOrEqual(TEXT_BAR);
      expect(contrast(p.accent2, CARD), `${t.code} accent2`).toBeGreaterThanOrEqual(TEXT_BAR);
    }
  });

  it("keeps both fills visible against the card", () => {
    for (const t of clubs) {
      const p = teamPalette(t);
      expect(contrast(p.fill, CARD), `${t.code} fill`).toBeGreaterThanOrEqual(FILL_BAR);
      expect(contrast(p.fill2, CARD), `${t.code} fill2`).toBeGreaterThanOrEqual(FILL_BAR);
    }
  });

  it("puts readable ink on every filled button", () => {
    for (const t of clubs) {
      const p = teamPalette(t);
      expect(contrast(p.onAccent, p.fill), `${t.code} onAccent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never collapses the two accents into one colour", () => {
    /* If accent and accent-2 land in the same place the app has one accent
       and every link looks the same as every heading. */
    for (const t of clubs) {
      const p = teamPalette(t);
      const sameHue = (() => {
        const A = rgbToHsl(hexToRgb(p.accent)), B = rgbToHsl(hexToRgb(p.accent2));
        const d = Math.abs(A.h - B.h) % 1;
        return Math.min(d, 1 - d) < 0.07 && (A.s > 0.12 && B.s > 0.12);
      })();
      const brightnessApart = contrast(p.accent, p.accent2) >= 1.35;
      expect(brightnessApart || !sameHue, `${t.code} accents are indistinct`).toBe(true);
    }
  });

  it("does not recolour the statuses", () => {
    /* "Paid" and "unpaid" have to stay tellable apart on the fees screen
       whichever club somebody supports, so ok/warn/danger are fixed. */
    const base = teamPalette(clubs[0]);
    for (const t of clubs) {
      const p = teamPalette(t);
      for (const key of ["ok", "warnInk", "dangerInk", "scUnder", "scOver", "scBad", "milestone"]) {
        expect(p[key], `${t.code} moved ${key}`).toBe(base[key]);
      }
    }
  });

  it("keeps the champion gold out of team hands", () => {
    for (const t of clubs) expect(teamPalette(t).milestone).toBe("#EFC94C");
  });

  it("stays a dark palette", () => {
    for (const t of clubs) {
      const p = teamPalette(t);
      expect(luminance(p.bg)).toBeLessThan(0.05);
      expect(contrast(p.text, p.bg2)).toBeGreaterThanOrEqual(TEXT_BAR);
    }
  });

  it("refuses a club with no usable primary", () => {
    expect(teamPalette(null)).toBeNull();
    expect(teamPalette({ primary: "nope" })).toBeNull();
    /* A missing secondary falls back to white - the third colour. */
    expect(teamPalette({ primary: "#E31837" })).not.toBeNull();
  });
});
