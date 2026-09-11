import { describe, expect, it } from "vitest";
import {
  COST_BASIS, DEFAULT_RULES, KEEPER_ROUND_FLOOR, LEGACY_COST_BASIS, LEGACY_PROGRESSION, PROGRESSION,
  auditSavedBasis, configFor, decisionContext, describeCostBasis, describeRules,
  evaluate, keeperCost, legacyKeeperNames, priorKeeperSeasons,
  priorSeasonDraftRound, ruleExample, keeperTenure, validateConfig } from "./keeper-rules.js";

const ok = (raw) => {
  const v = validateConfig(raw);
  expect(v.ok, v.errors.join("; ")).toBe(true);
  return v.config;
};
const DEFAULT = ok(DEFAULT_RULES);
/* The alternative set from the brief: 2-year max, 2 rounds earlier. */
const CHANGED = ok({ ...DEFAULT_RULES, effective_season: 2027,
                     max_keeper_seasons: 2, round_adjustment: 2 });

describe("the three seasons a keeper decision spans", () => {
  it("maps a 2026 decision to 2025 production, 2025 draft and 2026 market", () => {
    expect(decisionContext(2026)).toEqual({
      targetSeason: 2026, productionSeason: 2025,
      draftBasisSeason: 2025, marketSeason: 2026,
    });
  });

  it("maps 2027 and 2028 the same way, one season on each time", () => {
    expect(decisionContext(2027)).toEqual({
      targetSeason: 2027, productionSeason: 2026,
      draftBasisSeason: 2026, marketSeason: 2027,
    });
    expect(decisionContext(2028)).toEqual({
      targetSeason: 2028, productionSeason: 2027,
      draftBasisSeason: 2027, marketSeason: 2028,
    });
  });

  it("never puts the market in the past or production in the future", () => {
    for (const season of [2026, 2027, 2030, 2041]) {
      const c = decisionContext(season);
      expect(c.marketSeason).toBe(season);
      expect(c.productionSeason).toBe(season - 1);
      expect(c.draftBasisSeason).toBe(c.productionSeason);
    }
  });

  it("returns nulls rather than NaN for a season it cannot read", () => {
    expect(decisionContext(null).targetSeason).toBeNull();
    expect(decisionContext("nonsense").draftBasisSeason).toBeNull();
  });
});

describe("keeper cost under the commissioner's stated rules", () => {
  it("is one round earlier than the previous season's draft round, floored at R1", () => {
    expect(keeperCost(8, DEFAULT)).toBe(7);
    expect(keeperCost(5, DEFAULT)).toBe(4);
    expect(keeperCost(2, DEFAULT)).toBe(1);
    expect(keeperCost(1, DEFAULT)).toBe(1);      // the floor holds
  });

  it("does NOT compound across keeper years", () => {
    /* The rule the commissioner stated: 2025 R8 costs R7 in year one, R7 in
       year two and R7 in year three. */
    expect(keeperCost(8, DEFAULT, 1)).toBe(7);
    expect(keeperCost(8, DEFAULT, 2)).toBe(7);
    expect(keeperCost(8, DEFAULT, 3)).toBe(7);
  });

  it("can escalate instead, when a league configures that", () => {
    const climbing = ok({ ...DEFAULT_RULES, progression: PROGRESSION.ESCALATES_PER_YEAR });
    expect(keeperCost(8, climbing, 1)).toBe(7);
    expect(keeperCost(8, climbing, 2)).toBe(6);
    expect(keeperCost(8, climbing, 3)).toBe(5);
    expect(keeperCost(2, climbing, 5)).toBe(1);  // still floored
  });

  it("returns null rather than a number when the basis round is unknown", () => {
    expect(keeperCost(null, DEFAULT)).toBeNull();
    expect(keeperCost(undefined, DEFAULT)).toBeNull();
    expect(keeperCost(0, DEFAULT)).toBeNull();
    expect(keeperCost(8, null)).toBeNull();
  });
});

describe("changed configuration", () => {
  it("applies the new adjustment and floor", () => {
    expect(keeperCost(8, CHANGED)).toBe(6);
    expect(keeperCost(5, CHANGED)).toBe(3);
    expect(keeperCost(2, CHANGED)).toBe(1);      // 2 - 2 = 0, floored to 1
    expect(keeperCost(1, CHANGED)).toBe(1);
  });

  it("applies the new tenure limit", () => {
    const at = (prior, config) => evaluate({ config, targetSeason: config.effective_season,
                                             basisRound: 8, priorKeeperSeasons: prior });
    expect(at(0, CHANGED).reason).toBe("Year 1 of 2");
    expect(at(1, CHANGED).finalKeeperYear).toBe(true);
    expect(at(2, CHANGED).state).toBe("unavailable");
    /* And the default set is unaffected by the other existing. */
    expect(at(1, DEFAULT).reason).toBe("Year 2 of 3");
    expect(at(2, DEFAULT).finalKeeperYear).toBe(true);
  });

  it("never hard-codes the maximum into the labels", () => {
    expect(evaluate({ config: DEFAULT, targetSeason: 2026, basisRound: 8, priorKeeperSeasons: 0 })
      .maxKeeperYears).toBe(3);
    expect(evaluate({ config: CHANGED, targetSeason: 2027, basisRound: 8, priorKeeperSeasons: 0 })
      .maxKeeperYears).toBe(2);
  });
});

describe("tenure states under the default rules", () => {
  const at = (prior) => evaluate({ config: DEFAULT, targetSeason: 2026,
                                   basisRound: 8, priorKeeperSeasons: prior });

  it("counts 0, 1, 2 prior seasons and then refuses", () => {
    expect(at(0)).toMatchObject({ state: "eligible", keeperYear: 1, finalKeeperYear: false, calculatedRound: 7 });
    expect(at(1)).toMatchObject({ state: "eligible", keeperYear: 2, finalKeeperYear: false, calculatedRound: 7 });
    expect(at(2)).toMatchObject({ state: "eligible", keeperYear: 3, finalKeeperYear: true,  calculatedRound: 7 });
    expect(at(3)).toMatchObject({ state: "unavailable", eligible: false });
    expect(at(4).state).toBe("unavailable");
  });

  it("says why it is unavailable rather than just refusing", () => {
    expect(at(3).reason).toMatch(/Keeper limit reached/);
    expect(at(3).reviewNeeded).toBe(false);      // not a data problem
  });

  it("names the missing season when the basis round is unknown, without blocking", () => {
    const out = evaluate({ config: DEFAULT, targetSeason: 2026, basisRound: null, priorKeeperSeasons: 0 });
    expect(out.state).toBe("review");
    expect(out.reviewNeeded).toBe(true);
    expect(out.calculatedRound).toBeNull();
    /* Tenure is still known even when the round is not - that is useful. */
    expect(out.keeperYear).toBe(1);
    expect(out.maxKeeperYears).toBe(3);
    expect(out.reason).toBe("2025 draft round not found — needs commissioner review");
    /* And 2027 asks after 2026, not after 2025. */
    expect(evaluate({ config: DEFAULT, targetSeason: 2027, basisRound: null }).reason)
      .toBe("2026 draft round not found — needs commissioner review");
  });

  it("says nothing about seasons that do not affect the calculation", () => {
    const out = evaluate({ config: DEFAULT, targetSeason: 2026, basisRound: null });
    expect(out.reason).not.toMatch(/predate|earliest|original|2019|2020/i);
  });

  it("checks the tenure limit even when the round is unknown", () => {
    const out = evaluate({ config: DEFAULT, targetSeason: 2026, basisRound: null, priorKeeperSeasons: 3 });
    expect(out.state).toBe("unavailable");
  });

  it("reports no-rules rather than inventing a calculation", () => {
    const out = evaluate({ config: null, targetSeason: 2026, basisRound: 8 });
    expect(out.state).toBe("no-rules");
    expect(out.calculatedRound).toBeNull();
    expect(out.reason).toMatch(/No keeper rules are configured/);
  });

  it("carries the basis season through, defaulted from the target season", () => {
    expect(evaluate({ config: DEFAULT, targetSeason: 2026, basisRound: 8 }).basisSeason).toBe(2025);
    expect(evaluate({ config: DEFAULT, targetSeason: 2028, basisRound: 8 }).basisSeason).toBe(2027);
  });
});

describe("season awareness: a rule change never rewrites the past", () => {
  const sets = [DEFAULT_RULES, { ...DEFAULT_RULES, effective_season: 2027,
                                 max_keeper_seasons: 2, round_adjustment: 2 }];

  it("picks the newest rule set effective at or before the target season", () => {
    expect(configFor(sets, 2026).effective_season).toBe(2026);
    expect(configFor(sets, 2026).round_adjustment).toBe(1);
    expect(configFor(sets, 2027).effective_season).toBe(2027);
    expect(configFor(sets, 2027).round_adjustment).toBe(2);
    expect(configFor(sets, 2030).effective_season).toBe(2027);   // newest still applies
  });

  it("returns null for a season earlier than any configuration", () => {
    expect(configFor(sets, 2025)).toBeNull();
    expect(configFor([], 2026)).toBeNull();
    expect(configFor(sets, "nonsense")).toBeNull();
  });

  it("gives 2026 and 2027 different answers for the same player", () => {
    const p = { basisRound: 8, priorKeeperSeasons: 1 };
    const a = evaluate({ config: configFor(sets, 2026), targetSeason: 2026, ...p });
    const b = evaluate({ config: configFor(sets, 2027), targetSeason: 2027, ...p });
    expect(a.calculatedRound).toBe(7);
    expect(a.finalKeeperYear).toBe(false);       // year 2 of 3
    expect(b.calculatedRound).toBe(6);
    expect(b.finalKeeperYear).toBe(true);        // year 2 of 2
  });

  it("ignores a malformed rule set instead of letting it win", () => {
    const withJunk = [...sets, { effective_season: 2028, max_keeper_seasons: 0, round_adjustment: -1, min_keeper_round: 0 }];
    expect(configFor(withJunk, 2029).effective_season).toBe(2027);
  });
});

describe("configuration validation", () => {
  it("accepts the seeded defaults", () => {
    expect(validateConfig(DEFAULT_RULES).ok).toBe(true);
    expect(DEFAULT.cost_basis).toBe(COST_BASIS.PREVIOUS_SEASON_DRAFT_ROUND);
    expect(DEFAULT.progression).toBe(PROGRESSION.FIXED_FROM_BASIS);
  });

  it("MIGRATES the v1.106.0 spellings instead of breaking a live database", () => {
    /*
      Production was seeded with 'original_draft_round' and
      'fixed_from_original'. Rejecting those would take the keeper page down
      over a rename, so they are read, normalised and never written again.
    */
    const legacy = ok({ ...DEFAULT_RULES, cost_basis: LEGACY_COST_BASIS,
                        progression: LEGACY_PROGRESSION });
    expect(legacy.cost_basis).toBe(COST_BASIS.PREVIOUS_SEASON_DRAFT_ROUND);
    expect(legacy.progression).toBe(PROGRESSION.FIXED_FROM_BASIS);
    /* And the answer is identical either way, because only the WORDING was
       wrong in configuration - the arithmetic lives in keeperCost(). */
    expect(keeperCost(8, legacy)).toBe(keeperCost(8, DEFAULT));
  });

  it("floors at round 1 whatever a stored row claims the minimum is", () => {
    /*
      THE FLOOR IS ARITHMETIC, NOT POLICY. It used to be min_keeper_round, a
      setting between 1 and 40. A first-round keeper minus a round is R0 and R0
      is not a round, so the only sane value was 1 - and a rule that can only
      have one value should not be asking. A live row still carrying a
      different number must not change the answer.
    */
    expect(KEEPER_ROUND_FLOOR).toBe(1);
    const stored = { ...DEFAULT_RULES, min_keeper_round: 7 };
    expect(keeperCost(1, validateConfig(stored).config)).toBe(1);
    expect(keeperCost(2, validateConfig(stored).config)).toBe(1);
    expect(keeperCost(8, validateConfig(stored).config)).toBe(7);
    /* and an escalating league still cannot walk below it */
    const esc = validateConfig({ ...DEFAULT_RULES, round_adjustment: 3,
                                 progression: PROGRESSION.ESCALATES_PER_YEAR }).config;
    expect(keeperCost(4, esc, 9)).toBe(KEEPER_ROUND_FLOOR);
  });

  it("rejects every invalid shape the brief names", () => {
    const bad = (patch) => validateConfig({ ...DEFAULT_RULES, ...patch });
    expect(bad({ max_keeper_seasons: 0 }).ok).toBe(false);
    expect(bad({ max_keeper_seasons: -3 }).ok).toBe(false);
    expect(bad({ round_adjustment: -1 }).ok).toBe(false);
    /* min_keeper_round is no longer configuration. A stored row may still
       carry any value and it is IGNORED rather than rejected, because the floor
       is KEEPER_ROUND_FLOOR and a live database has to keep validating. */
    expect(bad({ min_keeper_round: 0 }).ok).toBe(true);
    expect(bad({ min_keeper_round: -2 }).ok).toBe(true);
    expect(validateConfig({ ...DEFAULT_RULES, min_keeper_round: 9 }).config.min_keeper_round)
      .toBe(undefined);
    expect(bad({ progression: "make_it_up" }).ok).toBe(false);
    expect(bad({ max_keeper_seasons: "three" }).ok).toBe(false);
    expect(bad({ round_adjustment: "" }).ok).toBe(false);
    expect(bad({ round_adjustment: 1.5 }).ok).toBe(false);
    expect(bad({ cost_basis: "auction_price" }).ok).toBe(false);
  });

  it("never returns a config alongside errors, so NaN cannot leak", () => {
    const v = validateConfig({ ...DEFAULT_RULES, max_keeper_seasons: 0 });
    expect(v.ok).toBe(false);
    expect(v.config).toBeNull();
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it("allows a zero adjustment, which means keep at the previous season's round", () => {
    const same = ok({ ...DEFAULT_RULES, round_adjustment: 0 });
    expect(keeperCost(8, same)).toBe(8);
  });
});

// =====================================================================
// THE CORRECTION ITSELF
// =====================================================================

describe("the keeper basis is the PREVIOUS SEASON's draft round", () => {
  /* The fixture from the brief: drafted three times, most recently in 2025. */
  const picks = [
    { player_id: "100", season: 2022, round: 8,  pick_no: 90 },
    { player_id: "100", season: 2024, round: 6,  pick_no: 66 },
    { player_id: "100", season: 2025, round: 1,  pick_no: 4  },
    { player_id: "200", season: 2024, round: 3,  pick_no: 30 },
    { player_id: "200", season: 2025, round: 10, pick_no: 118 },
    { player_id: "300", season: 2024, round: 8,  pick_no: 90 },
  ];

  it("takes the season before the keeper season, and NEVER the earliest", () => {
    /*
      This is the whole correction. 2022 R8 was what v1.106.0 used and it
      priced this player at R7; the rule is the 2025 round, which is R1, so
      the keeper costs R1.
    */
    const out = priorSeasonDraftRound(picks, "100", { targetSeason: 2026 });
    expect(out.round).toBe(1);
    expect(out.season).toBe(2025);
    expect(out.found).toBe(true);
    expect(keeperCost(out.round, DEFAULT)).toBe(1);
    expect(keeperCost(out.round, DEFAULT)).not.toBe(7);
  });

  it("applies the adjustment to that round and nothing else", () => {
    const out = priorSeasonDraftRound(picks, "200", { targetSeason: 2026 });
    expect(out.round).toBe(10);                   // 2025, not 2024's R3
    expect(keeperCost(out.round, DEFAULT)).toBe(9);
  });

  it("REFUSES to fall back to an older season", () => {
    /* Player 300 has a 2024 pick and no 2025 pick. R8 is on record and it is
       not the answer to a 2026 question. */
    const out = priorSeasonDraftRound(picks, "300", { targetSeason: 2026 });
    expect(out.round).toBeNull();
    expect(out.found).toBe(false);
    expect(out.season).toBe(2025);
    expect(out.reason).toBe("2025 draft round not found");
    const standing = evaluate({ config: DEFAULT, targetSeason: 2026,
                                basisRound: out.round, basisSeason: out.season });
    expect(standing.state).toBe("review");
    expect(standing.calculatedRound).toBeNull();
    expect(standing.calculatedRound).not.toBe(7);
  });

  it("still reports what IS on record, clearly separated from the basis", () => {
    /* The commissioner filling in a missing round is allowed to see the rest
       of the history. Nothing computes from it. */
    const out = priorSeasonDraftRound(picks, "300", { targetSeason: 2026 });
    expect(out.otherSeasons).toEqual([{ season: 2024, round: 8 }]);
    expect(out.round).toBeNull();
  });

  it("ADVANCES ONE SEASON EVERY YEAR, without a code change", () => {
    /* The critical test. Same player, two decisions, two different bases. */
    const p = [
      { player_id: "9", season: 2025, round: 8 },
      { player_id: "9", season: 2026, round: 4 },
    ];
    expect(priorSeasonDraftRound(p, "9", { targetSeason: 2026 }))
      .toMatchObject({ round: 8, season: 2025 });
    expect(priorSeasonDraftRound(p, "9", { targetSeason: 2027 }))
      .toMatchObject({ round: 4, season: 2026 });
    /* and the costs follow */
    expect(keeperCost(8, DEFAULT)).toBe(7);
    expect(keeperCost(4, DEFAULT)).toBe(3);
    /* 2028 has nothing to read yet, and says so rather than reusing 2026. */
    expect(priorSeasonDraftRound(p, "9", { targetSeason: 2028 }))
      .toMatchObject({ round: null, season: 2027, found: false });
  });

  it("returns null for a player this league never drafted", () => {
    const out = priorSeasonDraftRound(picks, "999", { targetSeason: 2026 });
    expect(out.round).toBeNull();
    expect(out.otherSeasons).toEqual([]);
    expect(evaluate({ config: DEFAULT, targetSeason: 2026, basisRound: out.round })
      .state).toBe("review");
  });

  it("ignores malformed pick rows and a missing target season", () => {
    expect(priorSeasonDraftRound([{ player_id: "1", season: "x", round: "y" }], "1",
      { targetSeason: 2026 }).round).toBeNull();
    expect(priorSeasonDraftRound([{ player_id: "1", season: 2025, round: 0 }], "1",
      { targetSeason: 2026 }).round).toBeNull();
    expect(priorSeasonDraftRound(null, "1", { targetSeason: 2026 }).round).toBeNull();
    expect(priorSeasonDraftRound(picks, "100", {}).round).toBeNull();
    expect(priorSeasonDraftRound(picks, "100", {}).reason).toMatch(/No keeper season/);
  });

  it("compares player ids as strings, so a numeric id still matches", () => {
    const numeric = [{ player_id: 100, season: 2025, round: 5 }];
    expect(priorSeasonDraftRound(numeric, "100", { targetSeason: 2026 }).round).toBe(5);
  });
});

describe("tenure from keeper history, and legacy rows", () => {
  const rows = [
    { year: 2024, member_id: 1, player_id: "100", player: "Bijan Robinson", round_cost: 7 },
    { year: 2025, member_id: 1, player_id: "100", player: "Bijan Robinson", round_cost: 7 },
    { year: 2025, member_id: 2, player_id: "200", player: "Puka Nacua", round_cost: 13 },
    /* Legacy rows: no player_id, nickname in `player`, first name in `team`. */
    { year: 2026, team: "Shawn", player: "Puka", round_cost: 13 },
    { year: 2026, team: "Izzy", player: "NA", round_cost: null },
  ];

  it("counts only canonical rows, and only seasons before the one being decided", () => {
    expect(priorKeeperSeasons(rows, { playerId: "100", memberId: 1, beforeSeason: 2026 })).toBe(2);
    expect(priorKeeperSeasons(rows, { playerId: "100", memberId: 1, beforeSeason: 2025 })).toBe(1);
    expect(priorKeeperSeasons(rows, { playerId: "200", memberId: 2, beforeSeason: 2026 })).toBe(1);
    expect(priorKeeperSeasons(rows, { playerId: "300", memberId: 1, beforeSeason: 2026 })).toBe(0);
  });

  it("keeps TENURE and COST as two separate calculations", () => {
    /*
      Kept in 2025 and 2026 means 2027 is the final keeper year. The 2027 COST
      comes from the 2026 draft board and knows nothing about that tenure -
      which is exactly what the brief insisted on.
    */
    const kept = [
      { year: 2025, member_id: 1, player_id: "7" },
      { year: 2026, member_id: 1, player_id: "7" },
    ];
    const prior = priorKeeperSeasons(kept, { playerId: "7", memberId: 1, beforeSeason: 2027 });
    expect(prior).toBe(2);

    const basis = priorSeasonDraftRound(
      [{ player_id: "7", season: 2025, round: 8 }, { player_id: "7", season: 2026, round: 4 }],
      "7", { targetSeason: 2027 });
    expect(basis.season).toBe(2026);
    expect(basis.round).toBe(4);

    const standing = evaluate({ config: DEFAULT, targetSeason: 2027,
                                basisRound: basis.round, basisSeason: basis.season,
                                priorKeeperSeasons: prior });
    expect(standing.keeperYear).toBe(3);
    expect(standing.finalKeeperYear).toBe(true);
    expect(standing.calculatedRound).toBe(3);     // from 2026's R4, not from tenure
  });

  it("does NOT infer tenure from a nickname", () => {
    const legacyOnly = [{ year: 2024, team: "Shawn", player: "Puka", round_cost: 13 }];
    expect(priorKeeperSeasons(legacyOnly, { playerId: "200", memberId: 2, beforeSeason: 2026 })).toBe(0);
  });

  it("counts a repeated season once", () => {
    const dupes = [
      { year: 2025, member_id: 1, player_id: "100" },
      { year: 2025, member_id: 1, player_id: "100" },
    ];
    expect(priorKeeperSeasons(dupes, { playerId: "100", memberId: 1, beforeSeason: 2026 })).toBe(1);
  });

  it("surfaces legacy rows verbatim for review, without matching them", () => {
    const legacy = legacyKeeperNames(rows, { beforeSeason: 2027 });
    expect(legacy).toHaveLength(2);
    expect(legacy.map((r) => r.player)).toEqual(["Puka", "NA"]);
    expect(legacy[0]).toMatchObject({ year: 2026, team: "Shawn", player: "Puka", round_cost: 13 });
  });
});

describe("auditing rows saved under the OLD basis", () => {
  const picks = [
    { player_id: "A", season: 2022, round: 8 },
    { player_id: "A", season: 2025, round: 1 },
    { player_id: "B", season: 2025, round: 1 },
    { player_id: "C", season: 2024, round: 8 },
  ];
  const sets = [DEFAULT_RULES];

  it("reports a row whose saved basis is not the previous season's round", () => {
    const rows = [{ id: 1, year: 2026, member_id: 1, player_id: "A", player: "A",
                    original_round: 8, calculated_round: 7, round_cost: 7 }];
    const out = auditSavedBasis(rows, picks, sets);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ savedBasis: 8, basisRound: 1, basisSeason: 2025,
                                   correctedRound: 1, overridden: false });
    expect(out[0].note).toMatch(/Saved from R8; the 2025 basis is R1/);
  });

  it("leaves a row alone when the old rule happened to give the same answer", () => {
    /* The one canonical row in production: Saquon Barkley, R1 in 2020 AND R1
       in 2025, so the wrong basis produced the right number. */
    const rows = [{ id: 2, year: 2026, member_id: 1, player_id: "B", player: "B",
                    original_round: 1, calculated_round: 1, round_cost: 1 }];
    expect(auditSavedBasis(rows, picks, sets)).toEqual([]);
  });

  it("flags a row with no previous-season draft record instead of guessing", () => {
    const rows = [{ id: 3, year: 2026, player_id: "C", player: "C",
                    original_round: 8, calculated_round: 7, round_cost: 7 }];
    const out = auditSavedBasis(rows, picks, sets);
    expect(out[0].basisRound).toBeNull();
    expect(out[0].note).toMatch(/No 2025 draft record/);
  });

  it("says when a discrepancy is a deliberate override", () => {
    const rows = [{ id: 4, year: 2026, player_id: "A", player: "A",
                    original_round: 8, calculated_round: 7, round_cost: 12,
                    round_overridden: true }];
    const out = auditSavedBasis(rows, picks, sets);
    expect(out[0].overridden).toBe(true);
    expect(out[0].note).toMatch(/deliberate|override/i);
  });

  it("recognises a row already saved under the corrected rule", () => {
    const rows = [{ id: 5, year: 2026, player_id: "A", player: "A",
                    basis_round: 1, basis_season: 2025, calculated_round: 1, round_cost: 1 }];
    expect(auditSavedBasis(rows, picks, sets)).toEqual([]);
  });

  it("never touches a legacy nickname row", () => {
    const rows = [{ id: 6, year: 2026, team: "Shawn", player: "Puka", round_cost: 13 }];
    expect(auditSavedBasis(rows, picks, sets)).toEqual([]);
  });

  it("returns findings and nothing else - it has no way to write", () => {
    const rows = [{ id: 1, year: 2026, player_id: "A", player: "A", original_round: 8,
                    calculated_round: 7, round_cost: 7 }];
    const before = JSON.stringify(rows);
    auditSavedBasis(rows, picks, sets);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("rule summaries are derived, never hard-coded", () => {
  it("describes the basis as the PREVIOUS SEASON's draft round", () => {
    /* " · Floor R1" came off this line with the setting. It described the one
       value that rule could ever have, so it told a reader nothing. */
    expect(describeRules(DEFAULT)).toBe("3-year maximum · Previous season's draft -1 round");
    expect(describeCostBasis(DEFAULT)).toBe("Previous season's draft round");
  });

  it("never says the word original", () => {
    for (const config of [DEFAULT, CHANGED, ok({ ...DEFAULT_RULES, round_adjustment: 0 })]) {
      expect(describeRules(config)).not.toMatch(/original/i);
      expect(describeCostBasis(config)).not.toMatch(/original/i);
      expect(ruleExample(config, { targetSeason: 2026 }).text).not.toMatch(/original/i);
    }
  });

  it("describes a changed set differently", () => {
    expect(describeRules(CHANGED)).toBe("2-year maximum · Previous season's draft -2 rounds");
  });

  it("handles a zero adjustment and an escalating league", () => {
    expect(describeRules(ok({ ...DEFAULT_RULES, round_adjustment: 0 })))
      .toBe("3-year maximum · Previous season's draft round");
    expect(describeRules(ok({ ...DEFAULT_RULES, progression: PROGRESSION.ESCALATES_PER_YEAR })))
      .toMatch(/cost climbs each keeper year$/);
  });

  it("returns null with nothing configured, so the UI omits the line", () => {
    expect(describeRules(null)).toBeNull();
    expect(describeCostBasis(null)).toBeNull();
    expect(ruleExample(null)).toBeNull();
  });

  it("shows a worked example in REAL SEASONS, from the configuration", () => {
    const ex = ruleExample(DEFAULT, { basisRound: 8, targetSeason: 2026 });
    expect(ex).toMatchObject({ basisRound: 8, cost: 7, targetSeason: 2026, basisSeason: 2025 });
    expect(ex.text).toBe("A player drafted in Round 8 in 2025 would cost Round 7 as a 2026 keeper.");
    /* and it moves with the season, rather than being frozen at 2025/2026 */
    expect(ruleExample(DEFAULT, { basisRound: 8, targetSeason: 2028 }).text)
      .toBe("A player drafted in Round 8 in 2027 would cost Round 7 as a 2028 keeper.");
    expect(ruleExample(CHANGED, { basisRound: 8 }).cost).toBe(6);
  });
});

describe("keeperTenure", () => {
  const rows = [
    { player_id: "7", member_id: "1", year: 2024 },
    { player_id: "7", member_id: "1", year: 2025 },
    { player_id: "9", member_id: "1", year: 2025 },
    { player_id: "7", member_id: "2", year: 2023 },   // a different manager's hold
    { player_id: null, member_id: "1", year: 2022 },  // legacy row, no player_id
  ];

  it("counts the year, the start and what is left", () => {
    const t = keeperTenure(rows, { playerId: "7", memberId: "1", season: 2026, max: 3 });
    expect(t.year).toBe(3);
    expect(t.firstSeason).toBe(2024);
    expect(t.left).toBe(0);
    expect(t.final).toBe(true);
  });

  it("treats a first-time keeper as year 1 starting this season", () => {
    const t = keeperTenure(rows, { playerId: "404", memberId: "1", season: 2026, max: 3 });
    expect(t.year).toBe(1);
    expect(t.firstSeason).toBe(2026);
    expect(t.left).toBe(2);
    expect(t.final).toBe(false);
  });

  it("does not count another manager's hold on the same player", () => {
    const t = keeperTenure(rows, { playerId: "7", memberId: "2", season: 2026, max: 3 });
    expect(t.year).toBe(2);
    expect(t.firstSeason).toBe(2023);
  });

  it("ignores legacy rows that carry no player_id", () => {
    const t = keeperTenure(rows, { playerId: "9", memberId: "1", season: 2026, max: 3 });
    expect(t.seasons).toEqual([2025]);
    expect(t.year).toBe(2);
  });

  it("survives an unconfigured maximum", () => {
    const t = keeperTenure(rows, { playerId: "7", memberId: "1", season: 2026, max: null });
    expect(t.max).toBeNull();
    expect(t.left).toBeNull();
    expect(t.final).toBe(false);
  });
});
