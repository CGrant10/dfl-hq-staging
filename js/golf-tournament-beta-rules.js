/* Tournament Beta access rules kept outside the DOM module so the same
   ownership decision is easy to test. Commissioners may score every card.
   Members may score only the individual side or team that contains them. */
export function canScoreBetaCard({ organizer = false, memberId = "", individual = false, cardId, sides = [], matchPlayers = [], participants = [] } = {}) {
  if (organizer) return true;
  const mine = String(memberId || "");
  if (!mine || cardId == null) return false;

  if (individual) {
    const side = sides.find(row => String(row.id) === String(cardId));
    if (!side) return false;
    const seats = new Set(matchPlayers.filter(row => String(row.side_id) === String(side.id)).map(row => String(row.participant_id)));
    return participants.some(person => seats.has(String(person.id)) && person.member_id != null && String(person.member_id) === mine);
  }

  return participants.some(person => person.member_id != null
    && String(person.member_id) === mine
    && String(person.team_id) === String(cardId));
}

export function betaRouteForMember({ organizer = false, setup = false, classic = false } = {}) {
  return !organizer && (setup || classic) ? "match" : setup ? "setup" : classic ? "classic" : "match";
}

export function betaEditableSideIds(state = {}) {
  return (state.sides || [])
    .filter(side => canScoreBetaCard({ ...state, individual: true, cardId: side.id }))
    .map(side => String(side.id));
}
