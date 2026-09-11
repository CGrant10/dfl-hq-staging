// =====================================================================
// sections.js - what every editable table looks like, in one place.
// ---------------------------------------------------------------------
// These specs used to live inside pages/admin.js, which is why editing
// only existed on the Admin page. They are now their own module, so both
// consumers can share them:
//
//   inline.js       the Edit / Delete / Add buttons that appear beside
//                   content on the normal pages when an admin is signed in
//   crud.js         the full-table manager, still used by the Admin page
//                   for the two structural lists (members, rule tabs)
//
// Add a field here and it shows up in the inline dialog, the admin
// manager, and the save - all three.
//
// Spec shape:
//   table     the Postgres table
//   singular  "rule"      - used in headings: Add rule / Edit rule
//   plural    "rules"     - used in empty states
//   label(r)  a one-line name for the row, shown in delete confirmations
//   sub(r)    optional second line for the admin manager list
//   fields    see form.js
// =====================================================================

import { themeKeys, themeLabel } from "./arena/sprite-themes.js";

/** Every Arena theme, for the event editor. */
const themeOptions = () => themeKeys().map((k) => ({ value: k, label: themeLabel(k) }));

const THIS_YEAR = new Date().getFullYear();

export const SECTIONS = [
  {
    id: "announcements", tab: "News",
    table: "announcements", singular: "announcement", plural: "announcements",
    label: (r) => r.title,
    sub:   (r) => (r.content || "").slice(0, 90),
    fields: [
      { name: "title",   label: "Title",   type: "text",     required: true, placeholder: "Draft is set" },
      { name: "content", label: "Message", type: "textarea", placeholder: "Details for the league…" },
    ],
  },
  {
    id: "polls", tab: "Polls",
    table: "polls", singular: "poll", plural: "polls",
    label: (r) => r.question,
    sub:   (r) => (r.active ? "Open" : "Closed"),
    fields: [
      { name: "question", label: "Question", type: "text", required: true,
        placeholder: "Should we run a March Madness bracket?" },
      { name: "options",  label: "Options (one per line)", type: "list", required: true,
        placeholder: "Yes\nNo\nMaybe" },
      { name: "active",   label: "Poll is open for voting", type: "checkbox", default: true },
    ],
  },
  {
    id: "arena_events", tab: "Arena",
    table: "arena_events", singular: "Arena event", plural: "Arena events",
    label: (r) => r.name,
    sub:   (r) => `${r.theme} · ${r.status}`,
    fields: [
      { name: "name",        label: "Event name", type: "text", required: true,
        placeholder: "2026 Draft Order" },
      { name: "description", label: "What is this for", type: "textarea",
        placeholder: "Winner picks first. Loser brings the beer." },
      /* Read off the themes themselves rather than typed out again. This
         list had already drifted from arena/sprite-themes.js - a theme added
         there was invisible here, so nobody could choose it. */
      { name: "theme",       label: "Racer theme", type: "select",
        options: themeOptions() },
      { name: "race_length", label: "Race length", type: "select",
        options: [
          { value: "short",  label: "Short (~12s)" },
          { value: "medium", label: "Medium (~22s)" },
          { value: "long",   label: "Long (~36s)" },
          { value: "custom", label: "Custom" },
        ], default: "medium" },
      { name: "length_ticks", label: "Custom length in ticks (25 = 1 second)", type: "number" },
      { name: "event_date",  label: "Date", type: "date" },
      { name: "notes",       label: "Notes", type: "textarea" },
    ],
  },
  {
    id: "golf_outings", tab: "Golf",
    table: "golf_outings", singular: "outing", plural: "outings",
    label: (r) => r.name,
    sub:   (r) => [r.course || "course TBD",
                   r.event_time ? String(r.event_time).slice(0, 5) : null,
                   r.status].filter(Boolean).join(" · "),
    fields: [
      { name: "name",   label: "Outing name", type: "text", required: true,
        placeholder: "DFL Draft Party Golf 2026" },
      { name: "course", label: "Course", type: "text", placeholder: "Hawktree" },
      { name: "event_date", label: "Date", type: "date" },
      /* Optional: an outing still being planned should not be forced to
         claim midnight. Blank means "no tee time yet". */
      { name: "event_time", label: "Tee time (optional)", type: "time" },
      { name: "holes",  label: "Holes", type: "number", default: 18 },
      { name: "status", label: "Status", type: "select",
        options: [
          { value: "setup",  label: "Setup" },
          { value: "active", label: "Live" },
          { value: "final",  label: "Final" },
        ], default: "setup" },
      { name: "notes",  label: "Notes", type: "textarea" },
    ],
  },
  {
    id: "rules", tab: "Rules",
    table: "rules", singular: "rule", plural: "rules",
    order: "sort_order", asc: true,
    label: (r) => `${r.title || "(untitled)"}`,
    sub:   (r) => `${r.category} · #${r.sort_order}`,
    fields: [
      { name: "category",   label: "Section", type: "select", required: true,
        optionsFrom: { table: "rule_categories", value: "key",
                       label: "label", order: "sort_order" } },
      { name: "title",      label: "Heading", type: "text", placeholder: "Trade deadline" },
      { name: "content",    label: "Text",    type: "textarea", required: true },
      { name: "sort_order", label: "Order within the section", type: "number", default: 1 },
    ],
  },
  {
    id: "rule_categories", tab: "Rule tabs",
    table: "rule_categories", singular: "rule tab", plural: "rule tabs",
    order: "sort_order", asc: true,
    label: (r) => r.label,
    sub:   (r) => `id: ${r.key}`,
    fields: [
      { name: "label", label: "Tab name (rename this freely)", type: "text",
        required: true, placeholder: "Draft Rules" },
      { name: "key",   label: "Permanent id — do not change once rules use it",
        type: "text", required: true, placeholder: "draft" },
      { name: "sort_order", label: "Tab order", type: "number", default: 10 },
    ],
  },
  {
    id: "keepers", tab: "Keepers",
    table: "keepers", singular: "keeper", plural: "keepers",
    order: "year", asc: false,
    label: (r) => `${r.player} — ${r.team}`,
    sub:   (r) => `${r.year} · ${r.round_cost != null ? "Round " + r.round_cost : "no cost set"}`,
    fields: [
      { name: "team",       label: "Team",        type: "text",   required: true, placeholder: "Slaw Squad" },
      { name: "player",     label: "Player",      type: "text",   required: true, placeholder: "Christian McCaffrey" },
      { name: "round_cost", label: "Round cost",  type: "number", placeholder: "2" },
      { name: "year",       label: "Season",      type: "number", required: true, default: THIS_YEAR },
      { name: "keeper_year",label: "Keeper year",  type: "number", placeholder: "1" },
      { name: "notes",      label: "Notes",       type: "textarea" },
    ],
  },
  {
    id: "events", tab: "Events",
    table: "events", singular: "event", plural: "events",
    order: "event_date", asc: true,
    label: (r) => r.title,
    sub:   (r) => (r.event_time ? `${r.event_date} · ${String(r.event_time).slice(0, 5)}` : r.event_date),
    fields: [
      { name: "title",       label: "Title", type: "text", required: true, placeholder: "Draft night" },
      { name: "event_date",  label: "Date",  type: "date", required: true },
      /* Optional on purpose: an all-day entry should not be forced to
         claim midnight. Blank means "no time set". */
      { name: "event_time",  label: "Start time (optional)", type: "time" },
      { name: "description", label: "Details", type: "textarea" },
    ],
  },
  {
    id: "history", tab: "History",
    table: "history", singular: "history entry", plural: "history entries",
    order: "year", asc: false,
    label: (r) => `${r.year} ${r.category}: ${r.winner}`,
    sub:   (r) => (r.notes || "").slice(0, 90),
    fields: [
      { name: "year",     label: "Year",     type: "number", required: true, default: THIS_YEAR - 1 },
      { name: "category", label: "Category", type: "select", required: true,
        options: ["Champion", "Runner Up", "Award", "Record", "Moment"] },
      { name: "winner",   label: "Who / what", type: "text", required: true, placeholder: "Slaw Squad" },
      { name: "notes",    label: "Notes",      type: "textarea" },
    ],
  },
  {
    id: "side_events", tab: "Side Events",
    table: "side_events", singular: "side event", plural: "side events",
    label: (r) => r.title,
    sub:   (r) => `${r.kind} · ${r.status}`,
    fields: [
      { name: "title",       label: "Title", type: "text", required: true, placeholder: "March Madness bracket" },
      { name: "kind",        label: "Type",  type: "select",
        options: ["Bracket", "Pick'em", "Survivor", "Other"] },
      { name: "status",      label: "Status", type: "select",
        options: ["Open", "Closed", "Finished"] },
      { name: "description", label: "Details", type: "textarea" },
      { name: "link",        label: "Link (optional)", type: "text", placeholder: "https://…" },
    ],
  },
  {
    id: "members", tab: "Members",
    table: "members", singular: "member", plural: "members",
    order: "display_name", asc: true,
    label: (r) => `${r.display_name}${r.team_name ? " — " + r.team_name : ""}`,
    sub:   (r) => `${r.active ? "active" : "inactive"}${r.championships ? ` · ${r.championships}× champ` : ""}`,
    fields: [
      { name: "display_name",  label: "Name shown in the picker", type: "text", required: true },
      /* Golf only. Nothing on the fantasy side reads this column - see
         golf_identity_schema.sql - so it can be whatever they answer to on
         a tee box without disturbing ten years of history. */
      { name: "golf_name",     label: "Golf name (blank = use the name above)", type: "text" },
      { name: "team_name",     label: "Fantasy team name", type: "text" },
      { name: "sleeper_user_id", label: "Sleeper account (links career stats)", type: "select",
        optionsFrom: { table: "sleeper_users", value: "sleeper_user_id",
                       label: "display_name", order: "display_name" } },
      { name: "joined_year",   label: "Joined the league in", type: "number" },
      { name: "championships", label: "Championships", type: "number", default: 0 },
      { name: "awards",        label: "Awards (one per line)", type: "textarea",
        placeholder: "Highest scorer 2025\nBest trade 2024" },
      /*
        PICK A FILE, NOT A URL.

        These four were text boxes asking for a link, which is why so many
        member pictures point at somebody else's server and no longer load. The
        image control shrinks on the device and stores the picture in the column
        itself - a headshot lands around 20KB - and it still accepts a pasted
        link so the rows that already hold one keep working. See image-shrink.js.
      */
      { name: "profile_image", label: "Profile picture", type: "image", preset: "avatar" },
      /*
        THE BROADCAST PICTURES. profile_image stays what it is - the
        picture of the person. These are for the stage, which wants more
        personality than a headshot.

        chaos_image is opt-in ONLY and no generator reaches for it: a
        slide has to ask for it by name, because "chaos" turning up on a
        championship card is not a nice surprise.
      */
      { name: "broadcast_image", label: "Broadcast image (used on stage slides)", type: "image" },
      { name: "lookalike_image", label: "Look-alike image (the celebrity double)", type: "image" },
      { name: "chaos_image",     label: "Chaos image (never chosen automatically)", type: "image" },
      { name: "notes",         label: "Notes", type: "textarea" },
      { name: "active",        label: "Show in the member picker", type: "checkbox", default: true },
      { name: "sort_order",    label: "Order in the list", type: "number", default: 0 },
    ],
  },
    {
    /*
      THE TICKER, and it is deliberately the smallest spec in this file.

      broadcast_items has twenty fields because a slide is a piece of design.
      A ticker line is a label, a sentence and somewhere to go - so this has five
      and nothing is marked `advanced`, because there is nothing here worth
      hiding. If it ever needs a sixth, that is the moment to ask whether it has
      stopped being a ticker.
    */
    id: "ticker_items", tab: "Ticker",
    table: "ticker_items", singular: "ticker line", plural: "ticker lines",
    order: "weight", asc: false,
    label: (r) => r.text || "Empty line",
    sub: (r) => {
      const bits = [];
      if (r.label) bits.push(r.label);
      if (!r.active) bits.push("off");
      if (r.starts_at || r.ends_at) bits.push("scheduled");
      if (r.weight) bits.push(`weight ${r.weight}`);
      return bits.join(" · ");
    },
    fields: [
      { name: "text", label: "The line", type: "text", required: true,
        placeholder: "Draft order draw is Thursday" },
      { name: "label", label: "Chip in front (optional)", type: "text",
        placeholder: "Reminder" },
      /* A route NAME, never a URL. bottomline.js maps it to #/<route> exactly as
         the derived items do, so a typo cannot make a link out of the app. */
      { name: "route", label: "Tapping it goes to", type: "select", default: "",
        options: [
          { value: "", label: "Nowhere" },
          { value: "home", label: "Home" },
          { value: "calendar", label: "Calendar" },
          { value: "polls", label: "Polls" },
          { value: "golf", label: "Golf" },
          { value: "keepers", label: "Keepers" },
          { value: "history", label: "History" },
          { value: "sportsbook", label: "Sportsbook" },
          { value: "finances", label: "Fees" },
        ] },
      { name: "weight", label: "Show earlier (higher first)", type: "number", default: 0 },
      { name: "active", label: "On", type: "checkbox", default: true },
      { name: "starts_at", label: "Show from (optional)", type: "datetime", advanced: true },
      { name: "ends_at", label: "Stop showing (optional)", type: "datetime", advanced: true },
    ],
  },
{
    id: "broadcast_items", tab: "Broadcast",
    table: "broadcast_items", singular: "broadcast slide", plural: "broadcast slides",
    order: "weight", asc: false,
    label: (r) => r.headline || r.kicker || "Untitled slide",
    sub:   (r) => {
      const bits = [r.treatment];
      if (r.featured) bits.push("featured");
      if (!r.active) bits.push("off");
      if (r.starts_at || r.ends_at) bits.push("scheduled");
      if (r.weight) bits.push(`weight ${r.weight}`);
      return bits.join(" · ");
    },
    fields: [
      /* The treatment list is the one broadcast-stage.js actually
         implements, and the database CHECK enforces the same six. An
         unknown one degrades to an announcement rather than blanking the
         stage, but there is no reason to offer a seventh here. */
      { name: "treatment", label: "How it looks", type: "select", default: "announcement",
        options: [
          { value: "announcement", label: "Announcement — headline and copy" },
          { value: "hero",         label: "Hero — a statement" },
          { value: "stat",         label: "Stat — one big figure" },
          { value: "event",        label: "Event — a date and how far off it is" },
          { value: "champion",     label: "Champion — one name, at size" },
          { value: "scoreboard",   label: "Scoreboard — two sides (needs scores; usually automatic)" },
        ] },
      { name: "kicker",   label: "Kicker (small line above)", type: "text", placeholder: "From the commissioner" },
      { name: "headline", label: "Headline", type: "text", required: true, placeholder: "Draft night is set" },
      { name: "subtitle", label: "Subtitle", type: "text", placeholder: "Saturday, 7pm" },
      { name: "body",     label: "Body copy", type: "textarea", placeholder: "Bring your own excuses." },
      { name: "figure", advanced: true,   label: "Big figure (stat slides only)", type: "text", placeholder: "10" },
      /*
        UP FRONT, BECAUSE A PICTURE IS THE POINT OF THE SLIDE.

        It sat behind "More options" with fourteen other fields, so making a
        picture slide meant knowing to open the disclosure AND knowing that
        Background had to be switched to "Image" as well. The deck now infers
        the second half - see manualBackground() in broadcast-deck.js - and
        this is the first half: choose a picture where you write the words.
      */
      { name: "image", label: "Picture (optional — becomes the slide's artwork)", type: "image", framing: true },
      /*
        THE CROP IS PART OF CHOOSING THE PICTURE, so it is drawn by the control
        above rather than asked for again down here. These four lines are what
        keeps the columns real: readForm() and setValue() still work by name, so
        a framing dragged onto the picture saves, and a saved one loads back.

        They were dropdowns reading "cover / center / center", which is a
        description of a crop and not a way to make one. Then they were nine
        buttons, which is nine crops out of all of them. Now the picture is
        dragged and pinched and the numbers are a consequence - x and y are
        percentages across the artwork, zoom is how far past the stage's own
        crop it is pushed. See broadcast_artwork_zoom_schema.sql, which has to
        have been run for a framing to save.
      */
      { name: "image_fit", type: "framing", default: "cover" },
      { name: "image_position_x", type: "framing", numeric: true, default: 50 },
      { name: "image_position_y", type: "framing", numeric: true, default: 50 },
      { name: "image_zoom", type: "framing", numeric: true, default: 1 },
      { name: "href", advanced: true,     label: "Tapping it goes to (optional)", type: "text", placeholder: "#/calendar" },
      /*
        TEMPORAL HONESTY IS NOT OPTIONAL, INCLUDING FOR HUMANS.

        Every automatic slide says whether it is live, coming, recent or
        history. A hand-written one that skipped that would be the one
        place on this screen where a date could be implied and never
        stated - so it is asked here too, and "makes no claim" is a real
        answer rather than a blank.
      */
      { name: "temporal", advanced: true, label: "When is this?", type: "select", default: "none",
        options: [
          { value: "none",       label: "Makes no claim about time" },
          { value: "upcoming",   label: "Upcoming" },
          { value: "live",       label: "Live right now" },
          { value: "recent",     label: "Recent" },
          { value: "final",      label: "Final" },
          { value: "historical", label: "From the archive" },
        ] },
      /*
        THE PLATE. One field, five looks - see broadcast_items_polish.sql.
        'image' composes the image above as artwork behind the words; there
        is deliberately no second image field.
      */
      { name: "background", advanced: true, label: "Background", type: "select", default: "default",
        options: [
          { value: "default", label: "Automatic — your picture if you added one, otherwise the DFL house look" },
          { value: "dark",    label: "Dark — dramatic title card" },
          { value: "light",   label: "Light — light plate, dark type" },
          { value: "image",   label: "Image — use the image above as artwork" },
          { value: "logo",    label: "Crest — the DFL mark, oversized" },
        ] },
      /*
        How loud the DFL crest sits behind this slide. Words rather than a
        number, because picking "faint" is a design decision and 0.043 is
        not. An image-heavy slide wants faint; a plain one can carry more.
      */
      { name: "logo_opacity", advanced: true, label: "DFL crest behind the slide", type: "select", default: "default",
        options: [
          { value: "default", label: "Default" },
          { value: "subtle",  label: "Subtle" },
          { value: "faint",   label: "Very faint — best over photos" },
          { value: "hidden",  label: "Hidden" },
        ] },
      /* Blank means "use the treatment default", which is the normal case.
         The range matches the CHECK on the column. */
      { name: "dwell_seconds", advanced: true, label: "Seconds on screen (blank = automatic)", type: "number",
        placeholder: "5" },
      { name: "featured", advanced: true, label: "Feature it (pins it to the front of the deck)", type: "checkbox", default: false },
      /* Order is set with the arrows on the Broadcast panel, not typed
         here - two ways to set one thing is how they end up disagreeing. */
      { name: "weight", advanced: true,   label: "Weight (moves it against automatic slides; 0 is normal)", type: "number", default: 0 },
      /* datetime, not date: a slide that starts "on the 29th" would appear
         at midnight, which is not what anyone means by draft night. */
      { name: "starts_at", advanced: true, label: "Show from (optional)", type: "datetime" },
      { name: "ends_at", advanced: true,   label: "Stop showing at (optional)", type: "datetime" },
      { name: "active", advanced: true,    label: "Slide is on", type: "checkbox", default: true },
    ],
  },
];

/** The spec for a table, or null if that table is not editable this way. */
export function specFor(table) {
  return SECTIONS.find((s) => s.table === table) || null;
}
