import { describe, expect, it } from "vitest";
import {
  CLASS, LABELS, NO_MARKET, NO_PRODUCTION, STRONG_FINISH,
  advise, badgesFor, candidates, comparisonRow, dataLevel, factsFor,
  isStrongFinish, marketFrom, orderingWeight, rankCandidates, whyFor,
} from "./keeper-advisor.js";
import { DEFAULT_RULES, validateConfig } from "./keeper-rules.js";
import { normalizeSleeperMarket } from "./keeper-market.js";

/* The Sleeper player map's real shape: {id: {n, p, t}}. */
const players = {
  "100": { n: "Bijan Robinson", p: "RB",  t: "ATL" },
  "200": { n: "Puka Nacua",     p: "WR",  t: "LAR" },
  "300": { n: "Drake Maye",     p: "QB",  t: "NE"  },
  "400": { n: "Retired Guy",    p: "RB",  t: "FA"  },
  "500": { n: "Boot Leg",       p: "K",   t: "BAL" },
  "SF":  { n: "SF",             p: "DEF", t: "SF"  },
  // "999" is deliberately absent: an id the player map does not know.
};

/*
  sleeper_draft_picks rows. Player 100 was drafted in 2022 AND in 2025, in
  different rounds - which is the case the whole correction turns on.
*/
const picks = [
  { season: 2022, player_id: "100", round: 8,  pick_no: 90,  sleeper_user_id: "meU" },
  { season: 2025, player_id: "100", round: 1,  pick_no: 4,   sleeper_user_id: "meU" },
  { season: 2025, player_id: "200", round: 12, pick_no: 140, sleeper_user_id: "otherU" },
  { season: 2025, player_id: "400", round: 9,  pick_no: 105, sleeper_user_id: "meU" },
  { season: 2024, player_id: "300", round: 6,  pick_no: 70,  sleeper_user_id: "meU" },
  { season: 2025, player_id: "500", round: 15, pick_no: 178, sleeper_user_id: "meU" },
  { season: 2025, player_id: "SF",  round: 14, pick_no: 166, sleeper_user_id: "meU" },
];

const roster = { season: 2025, players: ["100", "200", "300", "400", "500", "SF", "999"] };
const member = { id: 1, display_name: "Grant", sleeper_user_id: "meU" };
const rules = validateConfig(DEFAULT_RULES).config;

const base = {
  member, sleeperUserId: "meU", roster, players, draftPicks: picks,
  rules, targetSeason: 2026, keeperRows: [], maxKeepers: 1,
};

describe("the keeper cost comes from the PREVIOUS SEASON's draft round", () => {
  it("prices from 2025, not from the earliest pick on record", () => {
    /*
      Player 100 went R8 in 2022 and R1 in 2025. v1.106.0 read the earliest
      pick and charged R7; the league's rule is the 2025 round, so the keeper
      costs R1.
    */
    const out = advise(base);
    const bijan = out.candidates.find((c) => c.playerId === "100");
    expect(bijan.basisSeason).toBe(2025);
    expect(bijan.basisRound).toBe(1);
    expect(bijan.keeperCost).toBe(1);
    expect(bijan.keeperCost).not.toBe(7);
    expect(bijan.standing).toBe("eligible");
  });

  it("prices the floor case and the ordinary case from the same season", () => {
    const out = advise(base);
    const puka = out.candidates.find((c) => c.playerId === "200");
    expect(puka.basisRound).toBe(12);     // 2025
    expect(puka.keeperCost).toBe(11);
  });

  it("NEVER falls back to an older draft when the previous season is missing", () => {
    /* Player 300 has a 2024 R6 and no 2025 pick. R5 must not appear. */
    const out = advise(base);
    const maye = out.candidates.find((c) => c.playerId === "300");
    expect(maye.basisSeason).toBe(2025);
    expect(maye.basisRound).toBeNull();
    expect(maye.keeperCost).toBeNull();
    expect(maye.keeperCost).not.toBe(5);
    expect(maye.standing).toBe("review");
    expect(maye.reviewNeeded).toBe(true);
    expect(maye.basisReason).toBe("2025 draft round not found");
    expect(badgesFor(maye, out.candidates)).toContain(LABELS.NEEDS_REVIEW);
  });

  it("labels every displayed figure with its season", () => {
    const out = advise(base);
    const bijan = out.candidates.find((c) => c.playerId === "100");
    const facts = factsFor(bijan);
    expect(facts.find((f) => f.label === "2025 DFL draft").value).toBe("Round 1");
    expect(facts.find((f) => f.label === "2026 keeper").value).toMatch(/^Round 1 · Year 1 of 3$/);
    for (const f of facts) expect(f.label).not.toMatch(/original/i);
  });

  it("says nothing about earliest drafts or seasons predating the sync", () => {
    const out = advise(base);
    for (const c of out.candidates) {
      const text = [whyFor(c), ...factsFor(c).map((f) => `${f.label} ${f.value}`)].join(" ");
      expect(text).not.toMatch(/original|earliest|predate|2019|2022|2024/i);
    }
  });

  it("advances a season without a code change", () => {
    const forward = [...picks, { season: 2026, player_id: "100", round: 4, sleeper_user_id: "meU" }];
    const a = advise({ ...base, draftPicks: forward, targetSeason: 2026 })
      .candidates.find((c) => c.playerId === "100");
    const b = advise({ ...base, draftPicks: forward, targetSeason: 2027 })
      .candidates.find((c) => c.playerId === "100");
    expect(a).toMatchObject({ basisSeason: 2025, basisRound: 1, keeperCost: 1 });
    expect(b).toMatchObject({ basisSeason: 2026, basisRound: 4, keeperCost: 3 });
  });

  it("names the three seasons a decision spans, on the result", () => {
    expect(advise(base).context).toEqual({
      targetSeason: 2026, productionSeason: 2025, draftBasisSeason: 2025, marketSeason: 2026,
    });
    expect(advise({ ...base, targetSeason: 2027 }).context).toEqual({
      targetSeason: 2027, productionSeason: 2026, draftBasisSeason: 2026, marketSeason: 2027,
    });
  });

  it("counts tenure from canonical rows and labels the final year", () => {
    const kept = (years) => years.map((y) => ({ year: y, member_id: 1, player_id: "100" }));
    const at = (years) => advise({ ...base, keeperRows: kept(years) })
      .candidates.find((c) => c.playerId === "100");

    expect(at([])).toMatchObject({ keeperYear: 1, maxKeeperYears: 3, finalKeeperYear: false });
    expect(at([2025])).toMatchObject({ keeperYear: 2, finalKeeperYear: false });
    expect(at([2024, 2025])).toMatchObject({ keeperYear: 3, finalKeeperYear: true });

    const spent = at([2023, 2024, 2025]);
    expect(spent.standing).toBe("unavailable");
    expect(badgesFor(spent, [spent])).toContain(LABELS.LIMIT_REACHED);
    /* Tenure changed; the COST BASIS did not - it is still the 2025 round. */
    expect(at([2025]).basisRound).toBe(1);
  });

  it("reports no-rules honestly instead of inventing a cost", () => {
    const out = advise({ ...base, rules: null });
    expect(out.rules).toBeNull();
    expect(out.counts.costKnown).toBe(0);
    expect(out.candidates.every((c) => c.keeperCost === null)).toBe(true);
  });
});

// =====================================================================
// K AND DST ARE NOT EVALUATED, ANYWHERE
// =====================================================================

describe("only QB, RB, WR and TE are evaluated", () => {
  const out = advise(base);

  it("keeps the kicker and the defence out of the candidate pool", () => {
    const ids = out.candidates.map((c) => c.playerId);
    expect(ids).not.toContain("500");     // K
    expect(ids).not.toContain("SF");      // DEF
    expect(ids.sort()).toEqual(["100", "200", "300", "400", "999"]);
  });

  it("only ever lists the four positions, plus ids the map cannot classify", () => {
    for (const c of out.candidates) {
      if (c.class === CLASS.UNKNOWN) continue;
      expect(["QB", "RB", "WR", "TE"]).toContain(c.position);
    }
  });

  it("mentions neither anywhere in the output", () => {
    const everything = JSON.stringify({
      candidates: out.candidates.map((c) => ({
        c, facts: factsFor(c), why: whyFor(c), badges: badgesFor(c, out.candidates),
        row: comparisonRow(c),
      })),
      counts: out.counts,
    });
    expect(everything).not.toMatch(/Boot Leg/);
    expect(everything).not.toMatch(/"position":"K"/);
    expect(everything).not.toMatch(/"position":"DEF"/);
    expect(everything).not.toMatch(/\bDST\b/);
  });

  it("does not count them in the roster total it prints", () => {
    /* Seven ids on the roster; five are the Advisor's business. */
    expect(roster.players).toHaveLength(7);
    expect(out.counts.total).toBe(5);
  });

  it("keeps them out of the comparison and the shortlist too", () => {
    const rows = out.candidates.map(comparisonRow);
    expect(rows.every((r) => ["QB", "RB", "WR", "TE", ""].includes(r.position))).toBe(true);
    expect(out.candidates.slice(0, out.shortlist).map((c) => c.playerId)).not.toContain("SF");
  });
});

// =====================================================================
// REAL VALUE, from the brief's fixture
// =====================================================================

/*
  The four players from §38, built as roster + picks + production + market so
  the whole pipeline is exercised rather than the comparison in isolation.

  A  RB, 2025 RB4,  2025 draft R8, keeper R7, expected R2  -> +5
  B  RB, 2025 RB18, 2025 draft R8, keeper R7, expected R5  -> +2
  C  WR, 2025 WR3,  2025 draft R3, keeper R2, expected R1  -> +1
  D  DEF,           2025 draft R15                          -> absent
*/
const fixture = (() => {
  const map = {
    A: { n: "Player A", p: "RB",  t: "DET" },
    B: { n: "Player B", p: "RB",  t: "CHI" },
    C: { n: "Player C", p: "WR",  t: "CIN" },
    D: { n: "SF",       p: "DEF", t: "SF"  },
  };
  const draft = [
    { season: 2025, player_id: "A", round: 8,  sleeper_user_id: "meU" },
    { season: 2025, player_id: "B", round: 8,  sleeper_user_id: "meU" },
    { season: 2025, player_id: "C", round: 3,  sleeper_user_id: "meU" },
    { season: 2025, player_id: "D", round: 15, sleeper_user_id: "meU" },
  ];
  const production = new Map([
    ["A", { points: 286.4, positionRank: 4,  label: "RB4",  position: "RB", games: 17 }],
    ["B", { points: 168.2, positionRank: 18, label: "RB18", position: "RB", games: 16 }],
    ["C", { points: 301.0, positionRank: 3,  label: "WR3",  position: "WR", games: 17 }],
  ]);
  /* ADP chosen so the expected rounds are R2, R5 and R1 in a twelve-team
     league, and fed through the real normaliser rather than hand-built. */
  const market = marketFrom(normalizeSleeperMarket([
    { player_id: "C", player: { position: "WR" }, stats: { adp_ppr: 4.0 },  last_modified: Date.parse("2026-08-18") },
    { player_id: "A", player: { position: "RB" }, stats: { adp_ppr: 18.0 }, last_modified: Date.parse("2026-08-18") },
    { player_id: "B", player: { position: "RB" }, stats: { adp_ppr: 55.0 }, last_modified: Date.parse("2026-08-18") },
    { player_id: "D", player: { position: "DEF" }, stats: { adp_ppr: 150.0 }, last_modified: Date.parse("2026-08-18") },
  ], { leagueSize: 12, scoringFormat: "ppr", season: 2026 }), { now: Date.parse("2026-08-19") });

  return advise({
    member, sleeperUserId: "meU", rules, targetSeason: 2026, maxKeepers: 1,
    roster: { season: 2025, players: ["A", "B", "C", "D"] },
    players: map, draftPicks: draft, production, market,
  });
})();

describe("value ranking on the brief's own fixture", () => {
  const byId = (id) => fixture.candidates.find((c) => c.playerId === id);

  it("computes the round value the brief specifies", () => {
    expect(byId("A")).toMatchObject({ keeperCost: 7, marketProjectedRound: 2, roundValue: 5 });
    expect(byId("B")).toMatchObject({ keeperCost: 7, marketProjectedRound: 5, roundValue: 2 });
    expect(byId("C")).toMatchObject({ keeperCost: 2, marketProjectedRound: 1, roundValue: 1 });
    expect(byId("A").roundValueLabel).toBe("+5 rounds");
  });

  it("leaves the defence out entirely", () => {
    expect(byId("D")).toBeUndefined();
    expect(fixture.candidates).toHaveLength(3);
  });

  it("treats A better than B - better savings AND much better production", () => {
    const ids = fixture.candidates.map((c) => c.playerId);
    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
    expect(orderingWeight(byId("A"))).toBeGreaterThan(orderingWeight(byId("B")));
    expect(byId("A").strongProduction).toBe(true);
    expect(byId("B").strongProduction).toBe(true);   // RB18 is still a starter
    expect(byId("A").positionRank).toBeLessThan(byId("B").positionRank);
  });

  it("gives A the BEST VALUE call", () => {
    expect(badgesFor(byId("A"), fixture.candidates)).toContain(LABELS.BEST_VALUE);
    expect(badgesFor(byId("B"), fixture.candidates)).not.toContain(LABELS.BEST_VALUE);
  });

  it("STILL RECOGNISES C as the best player, on a smaller discount", () => {
    /* The failure mode the brief named: an elite player buried because the
       round saving is only +1. C is not top of the list and is not ignored. */
    expect(badgesFor(byId("C"), fixture.candidates)).toContain(LABELS.BEST_PLAYER);
    expect(byId("C").marketRank).toBe(1);
    expect(badgesFor(byId("A"), fixture.candidates)).not.toContain(LABELS.BEST_PLAYER);
  });

  it("does not rank on round savings alone", () => {
    /*
      A cheap keeper on a poor player must not lead. Player E saves +9 rounds
      and finished RB60; A saves +5 and finished RB4.
    */
    const map = { A: { n: "A", p: "RB", t: "DET" }, E: { n: "E", p: "RB", t: "NYJ" } };
    const production = new Map([
      ["A", { points: 286.4, positionRank: 4, label: "RB4", position: "RB" }],
      ["E", { points: 42.0, positionRank: 60, label: "RB60", position: "RB" }],
    ]);
    const market = marketFrom(normalizeSleeperMarket([
      { player_id: "A", player: { position: "RB" }, stats: { adp_ppr: 18 } },
      { player_id: "E", player: { position: "RB" }, stats: { adp_ppr: 60 } },
    ], { leagueSize: 12, scoringFormat: "ppr" }));
    const out = advise({
      member, sleeperUserId: "meU", rules, targetSeason: 2026,
      roster: { season: 2025, players: ["A", "E"] }, players: map,
      draftPicks: [{ season: 2025, player_id: "A", round: 8 },
                   { season: 2025, player_id: "E", round: 14 }],
      production, market,
    });
    const e = out.candidates.find((c) => c.playerId === "E");
    expect(e.roundValue).toBe(8);                     // R13 keeper vs expected R5
    expect(e.roundValue).toBeGreaterThan(5);
    expect(out.candidates[0].playerId).toBe("A");     // and still not top
    expect(badgesFor(e, out.candidates)).toContain(LABELS.VALUE_PLAY);
    expect(badgesFor(e, out.candidates)).not.toContain(LABELS.BEST_VALUE);
  });
});

describe("the recommendation labels have explicit criteria", () => {
  const one = ({ position = "RB", positionRank = 4, marketPositionRank = 5,
                 keeperCost = 7, expected = 2, finalKeeperYear = false } = {}) => ({
    playerId: "x", name: "X", position, standing: "eligible",
    positionRank, marketPositionRank, marketRank: 10,
    strongProduction: isStrongFinish(position, positionRank),
    strongMarket: isStrongFinish(position, marketPositionRank),
    keeperCost, marketProjectedRound: expected,
    roundValue: keeperCost - expected, finalKeeperYear, reviewNeeded: false,
  });

  it("states what a strong season is, per position", () => {
    expect(STRONG_FINISH).toEqual({ QB: 12, RB: 24, WR: 30, TE: 12 });
    expect(isStrongFinish("RB", 24)).toBe(true);
    expect(isStrongFinish("RB", 25)).toBe(false);
    expect(isStrongFinish("QB", 12)).toBe(true);
    expect(isStrongFinish("QB", 13)).toBe(false);
    expect(isStrongFinish("K", 1)).toBe(false);
    expect(isStrongFinish("RB", null)).toBe(false);
  });

  it("POOR VALUE only for overpaying on a player nobody rates", () => {
    /* Worse than the market, not at the floor, and weak on both measures. */
    const bad = one({ positionRank: 50, marketPositionRank: 60, keeperCost: 3, expected: 7 });
    expect(badgesFor(bad, [bad])).toContain(LABELS.POOR_VALUE);

    const better = one({ keeperCost: 7, expected: 2 });
    expect(badgesFor(better, [better])).not.toContain(LABELS.POOR_VALUE);
  });

  it("does NOT call paying the market price poor value", () => {
    /* Par is not a mistake. */
    const level = one({ positionRank: 50, marketPositionRank: 60, keeperCost: 4, expected: 4 });
    expect(badgesFor(level, [level])).not.toContain(LABELS.POOR_VALUE);
  });

  it("does NOT call an ELITE player poor value for costing a round more", () => {
    /* Overpaying by a round for a top-five player is a defensible choice. */
    const elite = one({ positionRank: 3, marketPositionRank: 2, keeperCost: 3, expected: 5 });
    expect(badgesFor(elite, [elite])).not.toContain(LABELS.POOR_VALUE);
  });

  it("NEVER calls a keeper at the rules' floor poor value", () => {
    /*
      Bijan Robinson: 2025 draft R1, so he keeps at R1 - the floor - and the
      market has him in round 1 too, for a round value of zero. The first cut
      badged the best player on the roster POOR VALUE, which is a complaint
      about the floor rule rather than about the pick.
    */
    const out = advise({ ...base, rules,
      roster: { season: 2025, players: ["100"] },
      production: new Map([["100", { points: 370.8, positionRank: 2, label: "RB2" }]]),
      market: marketFrom(normalizeSleeperMarket([
        { player_id: "100", player: { position: "RB" }, stats: { adp_ppr: 2.4 } },
      ], { leagueSize: 12, scoringFormat: "ppr" })),
    });
    const bijan = out.candidates[0];
    expect(bijan).toMatchObject({ basisRound: 1, keeperCost: 1, marketProjectedRound: 1,
                                  roundValue: 0, atFloor: true });
    const badges = badgesFor(bijan, out.candidates);
    expect(badges).not.toContain(LABELS.POOR_VALUE);
    expect(badges).toContain(LABELS.SAFE_CHOICE);
    expect(whyFor(bijan)).toMatch(/cheapest a keeper can cost/);
  });

  it("SAFE CHOICE needs strong production AND a strong market AND a discount", () => {
    expect(badgesFor(one(), [one()])).toContain(LABELS.SAFE_CHOICE);
    const weakSeason = one({ positionRank: 40 });
    expect(badgesFor(weakSeason, [weakSeason])).not.toContain(LABELS.SAFE_CHOICE);
    const coldMarket = one({ marketPositionRank: 40 });
    expect(badgesFor(coldMarket, [coldMarket])).not.toContain(LABELS.SAFE_CHOICE);
    const noDiscount = one({ keeperCost: 2, expected: 2 });
    expect(badgesFor(noDiscount, [noDiscount])).not.toContain(LABELS.SAFE_CHOICE);
  });

  it("VALUE PLAY is a real discount on a player last season does not vouch for", () => {
    const play = one({ positionRank: 50, keeperCost: 12, expected: 6 });
    expect(badgesFor(play, [play])).toContain(LABELS.VALUE_PLAY);
    expect(badgesFor(play, [play])).not.toContain(LABELS.BEST_VALUE);
    const tiny = one({ positionRank: 50, keeperCost: 7, expected: 6 });
    expect(badgesFor(tiny, [tiny])).not.toContain(LABELS.VALUE_PLAY);   // +1 is not a play
  });

  it("FINAL-YEAR VALUE only in the final keeper season, and only if positive", () => {
    const last = one({ finalKeeperYear: true });
    expect(badgesFor(last, [last])).toContain(LABELS.FINAL_YEAR);
    const lastButPoor = one({ finalKeeperYear: true, keeperCost: 2, expected: 5 });
    expect(badgesFor(lastButPoor, [lastButPoor])).not.toContain(LABELS.FINAL_YEAR);
    expect(badgesFor(one(), [one()])).not.toContain(LABELS.FINAL_YEAR);
  });

  it("awards each superlative to exactly one candidate", () => {
    const count = (label) => fixture.candidates
      .filter((c) => badgesFor(c, fixture.candidates).includes(label)).length;
    expect(count(LABELS.BEST_VALUE)).toBe(1);
    expect(count(LABELS.BEST_PLAYER)).toBe(1);
  });

  it("claims NO value label without a market price", () => {
    const noMarket = { ...one(), marketProjectedRound: null, roundValue: null,
                       marketRank: null, marketPositionRank: null, strongMarket: false };
    const badges = badgesFor(noMarket, [noMarket]);
    for (const label of [LABELS.BEST_VALUE, LABELS.SAFE_CHOICE, LABELS.VALUE_PLAY,
                         LABELS.POOR_VALUE, LABELS.FINAL_YEAR]) {
      expect(badges).not.toContain(label);
    }
  });

  it("says nothing at all about an unrecognised id", () => {
    const ghost = advise(base).candidates.find((c) => c.playerId === "999");
    expect(ghost.class).toBe(CLASS.UNKNOWN);
    expect(badgesFor(ghost, [ghost])).toEqual([LABELS.UNKNOWN_ID]);
    expect(factsFor(ghost)).toEqual([{ label: "Player", value: LABELS.UNKNOWN_ID }]);
  });

  it("still tells your own pick from one acquired since, by user id", () => {
    const out = advise(base);
    const byId = (id) => out.candidates.find((c) => c.playerId === id);
    expect(byId("100").draftedByMe).toBe(true);
    expect(byId("200").draftedByMe).toBe(false);
    expect(byId("300").draftedByMe).toBeNull();       // no 2025 pick at all
    expect(badgesFor(byId("200"), out.candidates)).toContain(LABELS.ACQUIRED);
    expect(badgesFor(byId("100"), out.candidates)).toContain(LABELS.RETURNING);
  });

  it("flags a player who is not on an NFL roster", () => {
    const out = advise(base);
    const gone = out.candidates.find((c) => c.playerId === "400");
    expect(gone.freeAgent).toBe(true);
    expect(badgesFor(gone, out.candidates)).toContain(LABELS.NOT_ON_NFL);
  });
});

// =====================================================================
// FALLBACK LEVELS
// =====================================================================

describe("the four fallback levels", () => {
  const production = new Map([["100", { points: 250.5, positionRank: 6, label: "RB6" }]]);
  const market = marketFrom(normalizeSleeperMarket([
    { player_id: "100", player: { position: "RB" }, stats: { adp_ppr: 18 },
      last_modified: Date.parse("2026-08-18") },
  ], { leagueSize: 12, scoringFormat: "ppr", season: 2026 }));

  it("LEVEL 1 with production and market", () => {
    const out = advise({ ...base, production, market });
    expect(out.data).toMatchObject({ level: 1, name: "full" });
    const bijan = out.candidates.find((c) => c.playerId === "100");
    expect(bijan.productionPoints).toBe(250.5);
    expect(bijan.roundValue).toBe(-1);      // keeper R1 against an expected R2
  });

  it("LEVEL 2 with production and no market - and no value claim", () => {
    const out = advise({ ...base, production });
    expect(out.data).toMatchObject({ level: 2, name: "no-market" });
    const bijan = out.candidates.find((c) => c.playerId === "100");
    expect(bijan.productionPoints).toBe(250.5);
    expect(bijan.roundValue).toBeNull();
    for (const c of out.candidates) {
      const badges = badgesFor(c, out.candidates);
      expect(badges).not.toContain(LABELS.BEST_VALUE);
      expect(badges).not.toContain(LABELS.VALUE_PLAY);
    }
    /* Production is still discussed, which is the point of level 2. */
    expect(whyFor(bijan)).toMatch(/2025 production/);
    expect(whyFor(bijan)).toMatch(/not a value claim/);
  });

  it("LEVEL 3 with market and no production - and no quality claim", () => {
    const out = advise({ ...base, market });
    expect(out.data).toMatchObject({ level: 3, name: "no-production" });
    const bijan = out.candidates.find((c) => c.playerId === "100");
    expect(bijan.productionPoints).toBeNull();
    expect(bijan.strongProduction).toBe(false);
    expect(bijan.marketProjectedRound).toBe(2);
    /* No production means nothing can be called strong, so BEST VALUE - which
       requires strong production - cannot be awarded. */
    expect(badgesFor(bijan, out.candidates)).not.toContain(LABELS.BEST_VALUE);
  });

  it("LEVEL 4 with neither, and it still draws the keeper facts", () => {
    const out = advise(base);
    expect(out.data).toMatchObject({ level: 4, name: "facts-only" });
    expect(out.candidates.length).toBeGreaterThan(0);
    const bijan = out.candidates.find((c) => c.playerId === "100");
    expect(factsFor(bijan).map((f) => f.label))
      .toEqual(["2025 DFL draft", "2026 keeper"]);
    expect(whyFor(bijan)).toBeTruthy();
  });

  it("never blanks the component, at any level", () => {
    for (const extra of [{}, { production }, { market }, { production, market }]) {
      const out = advise({ ...base, ...extra });
      expect(out.state).toBe("ready");
      expect(out.candidates.length).toBe(5);
      for (const c of out.candidates) {
        expect(factsFor(c).length).toBeGreaterThan(0);
        expect(whyFor(c)).toBeTruthy();
        expect(whyFor(c)).not.toMatch(/undefined|null|NaN/);
      }
    }
  });

  it("reports the market source and its freshness for the card to print", () => {
    const stale = marketFrom(normalizeSleeperMarket([
      { player_id: "100", player: { position: "RB" }, stats: { adp_ppr: 18 },
        last_modified: Date.parse("2026-07-01") },
    ], { leagueSize: 12, scoringFormat: "ppr", season: 2026 }),
      { now: Date.parse("2026-08-18") });
    const out = advise({ ...base, market: stale });
    expect(out.market.source).toBe("Sleeper ADP · 2026");
    expect(out.market.scoringFormat).toBe("ppr");
    expect(out.market.freshness.stale).toBe(true);
    expect(out.market.freshness.label).toMatch(/may be stale/);
  });

  it("dataLevel reads an empty list as facts-only rather than throwing", () => {
    expect(dataLevel([], NO_MARKET)).toMatchObject({ level: 4 });
    expect(NO_MARKET.available).toBe(false);
    expect(NO_PRODUCTION.size).toBe(0);
  });
});

// =====================================================================
// COMPARISON, ORDERING, STATES
// =====================================================================

describe("the WHY sentence grades itself to the facts", () => {
  const byId = (id) => fixture.candidates.find((c) => c.playerId === id);

  it("calls a positive discount draft value", () => {
    expect(whyFor(byId("A"))).toBe(
      "Strong 2025 production (RB4), an expected Round 2 price in 2026 and a "
      + "Round 7 keeper cost — +5 rounds of draft value.");
  });

  it("grades the adjective: strong, startable, then quieter", () => {
    const say = (position, positionRank) => whyFor({
      standing: "eligible", position, positionRank, productionSeason: 2025,
      productionPoints: 100, positionFinish: `${position}${positionRank}`,
      strongProduction: isStrongFinish(position, positionRank),
      keeperCost: 7, marketProjectedRound: 2, roundValue: 5, marketSeason: 2026,
    });
    expect(say("WR", 3)).toMatch(/^Strong 2025 production \(WR3\)/);
    expect(say("WR", 26)).toMatch(/^A startable 2025 \(WR26\)/);
    expect(say("WR", 45)).toMatch(/^A quieter 2025 \(WR45\)/);
    expect(say("QB", 6)).toMatch(/^Strong /);
    expect(say("QB", 11)).toMatch(/^A startable /);
  });

  it("says plainly when the keeper is the expensive option", () => {
    const even = { ...byId("C"), roundValue: 0 };
    expect(whyFor(even)).toMatch(/costs exactly what drafting them would\.$/);
    const worse = { ...byId("C"), keeperCost: 3, marketProjectedRound: 7, roundValue: -4 };
    expect(whyFor(worse)).toMatch(/−4 rounds: the keeper is the more expensive way/);
  });
});

describe("compare all", () => {
  it("names the season on every seasonal field", () => {
    const row = comparisonRow(fixture.candidates.find((c) => c.playerId === "A"));
    expect(row).toMatchObject({
      player: "Player A", position: "RB",
      productionSeason: 2025, productionPoints: 286.4, positionFinish: "RB4",
      basisSeason: 2025, basisRound: 8,
      keeperSeason: 2026, keeperRound: 7, keeperYear: 1, maxKeeperYears: 3,
      marketSeason: 2026, marketAdp: 18, expectedRound: 2, roundValue: 5,
    });
  });

  it("carries every field the brief lists", () => {
    for (const c of fixture.candidates) {
      expect(Object.keys(comparisonRow(c)).sort()).toEqual([
        "basisRound", "basisSeason", "expectedRound", "keeperRound", "keeperSeason",
        "keeperYear", "marketAdp", "marketSeason", "maxKeeperYears", "nflTeam",
        "positionFinish", "position", "productionPoints", "productionSeason",
        "player", "roundValue", "standing",
      ].sort());
    }
  });
});

describe("ordering is explainable, and stable", () => {
  it("puts eligible keepers first and sinks the ineligible", () => {
    const out = advise({ ...base,
      keeperRows: [{ year: 2023, member_id: 1, player_id: "200" },
                   { year: 2024, member_id: 1, player_id: "200" },
                   { year: 2025, member_id: 1, player_id: "200" }] });
    expect(out.candidates.at(-1).standing).toBe("unavailable");
    expect(out.candidates[0].standing).toBe("eligible");
    const unknownIndex = out.candidates.findIndex((c) => c.class === CLASS.UNKNOWN);
    const reviewIndex = out.candidates.findIndex((c) => c.standing === "review");
    expect(reviewIndex).toBeLessThan(unknownIndex);
  });

  it("sinks a player who is not on an NFL roster within their group", () => {
    const out = advise(base);
    const eligible = out.candidates.filter((c) => c.standing === "eligible");
    const gone = eligible.findIndex((c) => c.freeAgent);
    expect(gone).toBe(eligible.length - 1);
  });

  it("is stable: the same input gives the same order", () => {
    expect(advise(base).candidates.map((c) => c.playerId))
      .toEqual(advise(base).candidates.map((c) => c.playerId));
    expect(rankCandidates([])).toEqual([]);
  });

  it("never emits null or undefined into a displayed field", () => {
    for (const c of advise(base).candidates) {
      expect(typeof c.playerId).toBe("string");
      expect(typeof c.position).toBe("string");
      expect(typeof c.nflTeam).toBe("string");
      for (const f of factsFor(c)) {
        expect(f.label).not.toMatch(/undefined|null|NaN/);
        expect(String(f.value)).not.toMatch(/undefined|NaN/);
      }
      for (const b of badgesFor(c, [])) expect(b).toBeTruthy();
    }
  });
});

describe("every state the page has to draw", () => {
  it("names the state instead of returning an empty list", () => {
    expect(advise({}).state).toBe("no-member");
    expect(advise({ member }).state).toBe("no-sleeper-id");
    expect(advise({ member, sleeperUserId: "meU" }).state).toBe("no-roster");
    expect(advise({ member, sleeperUserId: "meU", roster: { players: [] } }).state).toBe("no-players");
    expect(advise(base).state).toBe("ready");
  });

  it("only ever lists players from that member's own roster", () => {
    const ids = new Set(advise(base).candidates.map((c) => c.playerId));
    for (const id of ids) expect(roster.players).toContain(id);
    expect(ids.has("500")).toBe(false);
  });

  it("counts what it knows, so the card can explain the gaps", () => {
    const out = advise(base);
    expect(out.counts.total).toBe(5);
    expect(out.counts.costKnown).toBe(3);        // 100, 200, 400
    expect(out.counts.needsReview).toBe(1);      // 300, no 2025 pick
    expect(out.counts.unknownPlayer).toBe(1);    // 999
    expect(out.counts.withProduction).toBe(0);
    expect(out.counts.withMarket).toBe(0);
  });
});
