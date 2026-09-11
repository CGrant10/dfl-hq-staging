import { edge, privilegedFunctionHeaders } from "../supabase.js";
import { loadMembers } from "../members.js";
import { esc, toast } from "../ui.js";
import { cleanNotificationDraft, NOTIFICATION_CATEGORIES } from "../notification-core.js";
import { ensureStylesheet } from "../lazy-css.js";

export async function renderNotificationPanel(host) {
  await ensureStylesheet("css/notifications.css");
  const members = await loadMembers();
  host.innerHTML = `<section class="admin-notify-panel"><div class="section-head"><div><h2>Send notification</h2><p class="muted">Delivered to the in-app inbox and any enabled phones.</p></div></div>
    <form class="card" id="notification-compose">
      <div class="form-grid two"><label>Title<input name="title" maxlength="80" required placeholder="League update"></label><label>Category<select name="category">${NOTIFICATION_CATEGORIES.map(([id,label]) => `<option value="${id}">${esc(label)}</option>`).join("")}</select></label></div>
      <label>Message<textarea name="body" maxlength="240" rows="3" required placeholder="What does the league need to know?"></textarea><small class="muted"><span data-notify-count>0</span>/240</small></label>
      <div class="form-grid two"><label>Opens to<select name="targetUrl"><option value="#/home">Home</option><option value="#/analyzer">Team analyzer</option><option value="#/polls">Polls</option><option value="#/finances">Fees</option><option value="#/calendar">Calendar</option><option value="#/rules">Rules</option><option value="#/notifications">Notifications</option></select></label><label>Recipients<select name="audience"><option value="all">Everyone</option><option value="members">Selected members</option></select></label></div>
      <fieldset class="notify-recipient-picker hidden"><legend>Choose members</legend>${members.map(member => `<label><input type="checkbox" value="${member.id}"><span><strong>${esc(member.display_name)}</strong>${member.team_name ? `<small>${esc(member.team_name)}</small>` : ""}</span></label>`).join("")}</fieldset>
      <div class="row-end"><button class="btn" type="submit">Send notification</button></div>
    </form><div data-notify-result></div></section>`;
  const form = host.querySelector("#notification-compose"), picker = host.querySelector(".notify-recipient-picker");
  form.elements.audience.addEventListener("change", () => picker.classList.toggle("hidden", form.elements.audience.value !== "members"));
  form.elements.body.addEventListener("input", () => { host.querySelector("[data-notify-count]").textContent = String(form.elements.body.value.length); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const draft = cleanNotificationDraft({
      title: form.elements.title.value,
      body: form.elements.body.value,
      category: form.elements.category.value,
      targetUrl: form.elements.targetUrl.value,
      audience: form.elements.audience.value,
      targetMemberIds: [...picker.querySelectorAll("input:checked")].map(input => input.value),
    });
    if (!draft.title || !draft.body) return toast("Add a title and message", true);
    if (form.elements.audience.value === "members" && !draft.targetMemberIds.length) return toast("Choose at least one member", true);
    btn.disabled = true;
    try {
      const { data, error } = await edge().functions.invoke("send-notification", {
        headers: privilegedFunctionHeaders(),
        body: { action: "send", ...draft },
      });
      if (error) {
        let detail = null;
        try { detail = await error.context?.json(); } catch {}
        throw new Error(detail?.error || detail?.message || error.message || "Could not send notification");
      }
      if (!data?.ok) throw new Error(data?.error || "Notification could not be sent");
      const delivered = Number(data.delivered) || 0;
      host.querySelector("[data-notify-result]").innerHTML = `<div class="card note"><div class="card-body"><strong>Sent to the league inbox.</strong><br><span class="muted">${delivered} phone${delivered === 1 ? "" : "s"} received push delivery${data.pushConfigured ? "." : "; phone delivery needs its server keys configured."}</span></div></div>`;
      form.reset(); picker.classList.add("hidden"); host.querySelector("[data-notify-count]").textContent = "0";
      toast("Notification sent");
    } catch (err) { toast(err.message || "Could not send notification", true); }
    finally { btn.disabled = false; }
  });
}
