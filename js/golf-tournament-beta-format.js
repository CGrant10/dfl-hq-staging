export const BETA_TEAM_SIZE = 6;
export const BETA_PAIRS_MATCHES = 3;
export const BETA_SINGLES_MATCHES = 6;
export const BETA_CUSTOM_MAX_SIDE = 4;

export function betaCustomSizes(round) {
  const match = String(round?.name || "").match(/^Custom Match · (\d+)v(\d+)(?: · Board off)?$/i);
  if (!match) return null;
  const sizes = [Number(match[1]), Number(match[2])];
  return sizes.every(size => size >= 1 && size <= BETA_CUSTOM_MAX_SIDE) ? sizes : null;
}

export const betaIsCustomRound = round => Boolean(betaCustomSizes(round));
export const betaCustomBoardVisible = round => !/ · Board off$/i.test(String(round?.name || ""));
export const betaCustomRoundName = (sizes, showBoard = true) => `Custom Match · ${sizes[0]}v${sizes[1]}${showBoard ? "" : " · Board off"}`;
export const betaRoundTitle = round => String(round?.name || "").replace(/ · Board off$/i, "");
export const betaRoundLabel = round => {
  if (betaIsCustomRound(round)) return `Custom ${betaCustomSizes(round).join(" vs ")}${round?.round_number ? ` · R${round.round_number}` : ""}`;
  const name = String(round?.name || "").trim();
  return /^(Pairs|Singles) \d+$/i.test(name) ? name : round?.format === "pairs" ? "Pairs" : "Singles";
};
export const betaSeatsForSide = (round, sideIndex = 0) => betaCustomSizes(round)?.[sideIndex] || (round?.format === "pairs" ? 2 : 1);

export function betaCaptainChoices(team, participants = []) {
  return participants.filter(person => person.member_id != null && String(person.team_id) === String(team?.id));
}

export function betaFormatStatus({ teams = [], participants = [], rounds = [] } = {}) {
  const counts = teams.map(team => participants.filter(person => String(person.team_id) === String(team.id)).length);
  const captainsReady = teams.length === 2 && teams.every(team => team.captain_member_id != null
    && betaCaptainChoices(team, participants).some(person => String(person.member_id) === String(team.captain_member_id)));
  const custom = rounds.find(entry => betaIsCustomRound(entry.round));
  const pairs = rounds.find(entry => entry.round?.format === "pairs" && !betaIsCustomRound(entry.round));
  const singles = rounds.find(entry => entry.round?.format === "singles" && entry.battles?.every(battle => battle.sides?.every(side => side.team_id != null)));
  const pairsReady = pairs?.battles?.length === BETA_PAIRS_MATCHES
    && pairs.battles.every(battle => battle.sides?.length === 2 && battle.sides.every(side => side.players?.length === 2));
  const singlesReady = singles?.battles?.length === BETA_SINGLES_MATCHES
    && singles.battles.every(battle => battle.sides?.length === 2 && battle.sides.every(side => side.players?.length === 1));
  const customSizes = betaCustomSizes(custom?.round);
  const customReady = customSizes && custom?.battles?.length === 1
    && custom.battles[0].sides?.length === 2
    && custom.battles[0].sides.every((side, index) => side.players?.length === customSizes[index]);
  return {
    teamsReady: teams.length === 2 && counts.length === 2 && counts.every(count => count === BETA_TEAM_SIZE),
    captainsReady,
    counts,
    pairs,
    singles,
    custom,
    pairsReady: Boolean(pairsReady),
    singlesReady: Boolean(singlesReady),
    customReady: Boolean(customReady),
    ready: teams.length === 2 && counts.every(count => count === BETA_TEAM_SIZE) && captainsReady && Boolean(pairsReady) && Boolean(singlesReady),
  };
}

export const betaRoundName = format => format === "pairs" ? "Round 1 · 2v2" : "Round 2 · Singles";
export function betaAddedRoundName(rounds = [], format) {
  const count = rounds.filter(entry => entry?.round?.format === format && !betaIsCustomRound(entry.round)).length + 1;
  return `${format === "pairs" ? "Pairs" : "Singles"} ${count}`;
}

export function betaSelectedRound(rounds = [], selected) {
  return rounds.find(entry => String(entry?.round?.id) === String(selected))
    || rounds.find(entry => entry?.round?.format === selected)
    || rounds[0];
}
export const betaMatchCount = format => format === "pairs" ? BETA_PAIRS_MATCHES : BETA_SINGLES_MATCHES;
export const betaSeatsPerSide = format => format === "pairs" ? 2 : 1;
