// =====================================================================
// Polls - one changeable vote per league member.
//
// Everyone sees the whole picture: the tallies, and who picked what. There
// is nothing to unlock by voting first, because in a twelve-person league
// everybody knows how everybody voted anyway.
//
// Your own vote is yours to change. Tapping a different option moves you,
// it does not add a second vote - the database does the swap in one step
// (see cast_vote() in polls_schema.sql).
//
// Admins get, inline on this page: add, edit, delete, close/reopen and
// reset votes. Those buttons are hidden for everybody else, and the
// database refuses the writes regardless.
// =====================================================================

import { db, isAdmin } from "../supabase.js";
import { esc, empty, toArray, toast, errorBox } from "../ui.js";
import { currentMember } from "../members.js";
import { addControl, editControls, wireInline, canEdit, visible, hiddenClass } from "../inline.js";

// Set when the database still predates polls_schema.sql. Voting cannot work
// in that state, so the page says so instead of failing to load.
let needsMigration = false;

/**
 * Votes, with member_id when the column is there.
 *
 * The page has to open on a database that has not had polls_schema.sql run
 * against it yet - that is exactly the state somebody is in when they pull
 * this version - so a missing column falls back to the old shape rather
 * than taking the whole page down.
 */
async function loadVotes() {
  const withMember = await db().from("votes").select("poll_id, member_id, username, answer");
  if (!withMember.error) { needsMigration = false; return withMember; }
  if (!/member_id/.test(withMember.error.message || "")) return withMember;

  needsMigration = true;
  return db().from("votes").select("poll_id, username, answer");
}

export async function render(view) {
  const me    = currentMember();
  const admin = isAdmin();

  const [pollsRes, votesRes, membersRes] = await Promise.all([
    db().from("polls").select("*").order("created_at", { ascending: false }),
    loadVotes(),
    db().from("members").select("id, display_name, team_name"),
  ]);

  if (pollsRes.error || votesRes.error) {
    view.innerHTML = errorBox(pollsRes.error || votesRes.error);
    return;
  }

  const polls   = pollsRes.data || [];
  const votes   = votesRes.data || [];
  const members = new Map((membersRes.data || []).map((m) => [String(m.id), m]));

  const shown  = visible("polls", polls);
  const open   = shown.filter((p) => p.active);
  const closed = shown.filter((p) => !p.active);

  /*
    OPEN POLLS ARE THE PAGE. The heading above them is only worth its space
    when there is something else below to distinguish them from - with no
    closed polls, "Open · 3" labels the entire screen and the three cards
    underneath already say they are open.
  */
  const openBlock = !open.length ? "" : `
    ${closed.length ? `<h2 class="section-title">Open<span class="count">${open.length}</span></h2>` : ""}
    ${open.map((p) => pollCard(p, votes, members, me, admin)).join("")}`;

  /*
    CLOSED POLLS ARE HISTORY, so they fold away behind one row instead of
    doubling the length of the page. Nothing is summarised: opening it gives
    back the identical result cards, with every voter name and every tally,
    because a decided poll is exactly the thing somebody scrolls back to
    settle an argument about.

    This is the app's one collapse implementation (js/collapse.js). The fold
    control is a real <button> carrying aria-expanded and an aria-label, it is
    keyboard operable, and the reader's choice is remembered per device -
    "folded" here is only the DEFAULT, so one tap keeps it open for good.

    Rendered only when there is something in it, so the page never shows an
    empty accordion.
  */
  const closedBlock = !closed.length ? "" : `
    <section class="poll-archive" data-collapse="polls-closed"
             data-collapse-default="folded"
             data-collapse-title="Closed polls"
             data-collapse-badge="${closed.length}">
      ${closed.map((p) => pollCard(p, votes, members, me, admin)).join("")}
    </section>`;

  view.innerHTML = `
    <div id="poll-list" class="polls-page">
      <header class="page-head">
        <h1>Polls</h1>
        ${addControl("polls", "Add poll")}
      </header>
      ${needsMigration ? `<div class="card note">
          <div class="card-body">Voting is not switched on yet. Run
          <strong>polls_schema.sql</strong> in the Supabase SQL editor, then reload.</div>
        </div>` : ""}

      ${me ? "" : `<div class="card note">
          <div class="card-body">Pick your name in the top right to vote.</div>
        </div>`}

      ${polls.length ? "" : empty("No polls yet.")}

      ${openBlock}
      ${closedBlock}
    </div>
  `;

  const list = view.querySelector("#poll-list");
  const refresh = () => render(view);

  // #poll-list is rebuilt on every render, so these never double up.
  wireInline(list, refresh);

  list.addEventListener("click", (e) => {
    const voteBtn   = e.target.closest("button[data-answer]");
    const clearBtn  = e.target.closest("button[data-clear-poll]");
    const toggleBtn = e.target.closest("button[data-toggle-poll]");
    const resetBtn  = e.target.closest("button[data-reset-poll]");

    if (voteBtn)   return castVote(view, voteBtn, me);
    if (clearBtn)  return clearVote(view, clearBtn, me);
    if (toggleBtn) return togglePoll(view, toggleBtn);
    if (resetBtn)  return resetVotes(view, resetBtn);
  });
}

// ------------------------------- voting -------------------------------

async function castVote(view, btn, me) {
  if (!me) { toast("Pick your name in the top right first", true); return; }
  if (btn.dataset.mine === "true") return;   // already your answer

  btn.disabled = true;
  const { error } = await db().rpc("cast_vote", {
    p_poll_id:   Number(btn.dataset.poll),
    p_member_id: Number(me.id),
    p_answer:    btn.dataset.answer,
  });

  if (error) {
    btn.disabled = false;
    toast(voteError(error), true);
    return;
  }
  toast(btn.dataset.had === "true" ? "Vote changed" : "Vote counted");
  render(view);
}

async function clearVote(view, btn, me) {
  if (!me) return;
  btn.disabled = true;
  const { error } = await db().rpc("clear_vote", {
    p_poll_id:   Number(btn.dataset.clearPoll),
    p_member_id: Number(me.id),
  });

  if (error) { btn.disabled = false; toast(voteError(error), true); return; }
  toast("Vote removed");
  render(view);
}

/**
 * The two functions are missing until polls_schema.sql has been run, and
 * "function does not exist" would not tell anybody what to do about it.
 */
function voteError(error) {
  const msg = error.message || "Could not save your vote";
  if (/could not find the function|does not exist|schema cache/i.test(msg)) {
    return "Run polls_schema.sql in Supabase to enable voting";
  }
  return msg;
}

// --------------------------- admin actions ----------------------------

async function togglePoll(view, btn) {
  const active = btn.dataset.active === "true";
  btn.disabled = true;

  const { error } = await db().from("polls")
    .update({ active: !active }).eq("id", btn.dataset.togglePoll);
  if (error) { toast(error.message, true); btn.disabled = false; return; }

  toast(active ? "Poll closed" : "Poll reopened");
  render(view);
}

async function resetVotes(view, btn) {
  if (!confirm("Delete every vote on this poll? This cannot be undone.")) return;
  btn.disabled = true;

  const { error } = await db().from("votes").delete().eq("poll_id", btn.dataset.resetPoll);
  if (error) { toast(error.message, true); btn.disabled = false; return; }

  toast("Votes reset");
  render(view);
}

// ------------------------------ drawing -------------------------------

function pollCard(poll, allVotes, members, me, admin) {
  const options = toArray(poll.options);
  const votes   = allVotes.filter((v) => v.poll_id === poll.id);
  const myVote  = me ? votes.find((v) => sameMember(v, me)) : null;

  return `
    <article class="card poll ${poll.active ? "is-open" : ""} ${hiddenClass("polls", poll)}">
      <header class="poll-head">
        <h3 class="poll-q">${esc(poll.question)}</h3>
        <div class="meta-row">
          <span class="pill ${poll.active ? "green" : "grey"}">${poll.active ? "Open" : "Closed"}</span>
          <span class="muted tiny">${votes.length} vote${votes.length === 1 ? "" : "s"}</span>
          ${myVote ? `<span class="pill">You picked ${esc(myVote.answer)}</span>` : ""}
        </div>
      </header>

      ${board(poll, options, votes, members, myVote, !!me)}

      ${poll.active
        ? `<p class="poll-you">
             ${myVote
               ? `Tap another option to change your vote.
                  <button class="linkbtn" data-clear-poll="${poll.id}">Remove my vote</button>`
               : me ? "Tap an option to vote." : "Pick your name in the top right to vote."}
           </p>`
        : `<p class="poll-you">This poll is closed. Results are final.</p>`}

      ${admin ? `
        <footer class="poll-admin">
          <span class="admin-tag">Admin</span>
          ${editControls("polls", poll, { compact: true })}
          <button class="btn ghost small" data-toggle-poll="${poll.id}" data-active="${poll.active}">
            ${poll.active ? "Close poll" : "Reopen"}
          </button>
          ${votes.length
            ? `<button class="btn ghost small" data-reset-poll="${poll.id}">Reset votes</button>` : ""}
        </footer>` : ""}
    </article>`;
}

/**
 * Every option, its share, and the people under it.
 *
 * Answers that are no longer on the ballot still appear, marked as
 * removed, so no vote is ever hidden just because an option was reworded.
 * Those are never votable - the database would refuse them anyway.
 */
function board(poll, options, votes, members, myVote, canVote) {
  const total  = votes.length || 1;
  const labels = [...new Set([...options, ...votes.map((v) => v.answer)])];

  if (!labels.length) {
    return `<p class="muted tiny">This poll has no options yet.</p>`;
  }

  return `<div class="results">${labels.map((label) => {
    const forThis = votes.filter((v) => v.answer === label);
    const pct     = Math.round((forThis.length / total) * 100);
    const mine    = myVote?.answer === label;
    const gone    = !options.includes(label);
    const votable = poll.active && !gone;

    // An option is a button while it can be chosen, and plain text once it
    // cannot, rather than a disabled button that still invites a tap.
    const head = `
      <div class="result-top">
        <span>${mine ? `<span class="you-dot" aria-hidden="true"></span>` : ""}${esc(label)}${
          gone ? ` <span class="muted tiny">(removed)</span>` : ""}</span>
        <span class="result-n">${forThis.length} · ${pct}%</span>
      </div>`;

    return `
      <div class="result ${mine ? "mine" : ""}">
        ${votable
          ? `<button class="result-pick" data-poll="${poll.id}" data-answer="${esc(label)}"
                     data-mine="${mine}" data-had="${!!myVote}"
                     ${canVote ? "" : "disabled"}
                     aria-pressed="${mine}">${head}</button>`
          : head}
        <div class="bar"><span style="width:${pct}%"></span></div>
        ${forThis.length
          ? `<div class="voters">${forThis
               .map((v) => `<span class="voter ${myVote && v === myVote ? "is-you" : ""}">${
                 esc(voterName(v, members))}</span>`).join("")}</div>`
          : `<div class="voters"><span class="muted tiny">nobody yet</span></div>`}
      </div>`;
  }).join("")}</div>`;
}

/** A vote's display name: the member profile first, the stored name after. */
function voterName(vote, members) {
  const m = vote.member_id != null ? members.get(String(vote.member_id)) : null;
  return m?.display_name || vote.username || "Someone";
}

/**
 * Whether a vote row belongs to `me`. Rows cast before polls_schema.sql was
 * run have no member_id, so those still match on the stored name.
 */
function sameMember(vote, me) {
  if (vote.member_id != null) return String(vote.member_id) === String(me.id);
  return String(vote.username || "").trim().toLowerCase()
      === String(me.display_name || "").trim().toLowerCase();
}
