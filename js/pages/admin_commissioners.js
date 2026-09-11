// =====================================================================
// Admin - Commissioner Access
// =====================================================================
import { db } from "../supabase.js";
import { esc, toast } from "../ui.js";
import { ensureBroadcastStyles } from "../lazy-css.js";
/* Same - idempotent, so asking twice costs nothing. */
ensureBroadcastStyles();

const PERMISSIONS = [
  ["announcements", "Announcements"],
  ["calendar", "Calendar"],
  ["polls", "Polls"],
  ["keepers", "Keepers"],
  ["golf", "Golf"],
  ["sportsbook", "Sportsbook"],
  ["broadcast", "Broadcast / Stage"],
  ["fees", "Fees"],
  ["history", "History / Facts"],
  ["rules", "Rules"],
  ["members", "Members"],
  ["sleeper", "Sleeper Sync"],
];

export async function renderCommissionerPanel(root) {
  root.innerHTML = `<div class="card"><div class="card-body">Loading commissioner access…</div></div>`;
  let members = [];
  try {
    const { data, error } = await db().from("members").select("id,display_name,team_name,active").eq("active", true).order("sort_order", { ascending: true }).order("display_name", { ascending: true });
    if (error) throw error;
    members = data || [];
  } catch (error) {
    root.innerHTML = `<div class="card note"><div class="card-body">${esc(error.message || "Could not load members")}</div></div>`;
    return;
  }
  if (!members.length) {
    root.innerHTML = `<div class="card"><div class="card-body">Add league members before assigning commissioner access.</div></div>`;
    return;
  }

  let accessEditorReady = true, accessRows = [];
  const accessResult = await db().rpc("list_commissioner_access");
  if (accessResult.error) accessEditorReady = false;
  else accessRows = accessResult.data || [];
  const accessByMember = new Map(accessRows.map(row => [String(row.member_id), {
    member_id: Number(row.member_id),
    is_owner: Boolean(row.is_owner),
    active: Boolean(row.active),
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
  }]));

  root.innerHTML = `
    <div class="section-head"><h2>Commissioner Access</h2></div>
    <div class="card note"><div class="card-body">Give a league member their own commissioner PIN and only the tools they should control. Select a member to review and adjust what they already have.</div></div>
    ${accessEditorReady ? "" : `<div class="card note"><div class="card-body">Current assignments cannot be loaded until <strong>commissioner_access_editor_schema.sql</strong> is run in Supabase. You can still replace access by entering a new PIN.</div></div>`}
    <form class="card" id="commissioner-form">
      <label for="commissioner-member">League member</label>
      <select id="commissioner-member" required>${members.map(member => `<option value="${esc(member.id)}">${esc(member.display_name || member.team_name || `Member ${member.id}`)}</option>`).join("")}</select>
      <p class="muted" id="commissioner-current" aria-live="polite"></p>
      <label for="commissioner-pin">Commissioner PIN</label>
      <input id="commissioner-pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" autocomplete="new-password" placeholder="At least 4 digits">
      <p class="muted" id="commissioner-pin-help"></p>
      <label class="checkrow"><input type="checkbox" id="commissioner-owner"> <span><strong>Owner</strong><br><small class="muted">Full access, including managing commissioners.</small></span></label>
      <div class="section-head"><h3>Permissions</h3></div>
      <div class="checklist" id="commissioner-perms">${PERMISSIONS.map(([key, label]) => `<label class="checkrow"><input type="checkbox" value="${esc(key)}"> <span>${esc(label)}</span></label>`).join("")}</div>
      <div class="row-end"><button type="button" class="btn danger ghost" id="commissioner-disable">Disable access</button><button type="submit" class="btn">Save changes</button></div>
    </form>

    <div class="card">
      <div class="card-title">Profile PIN rescue</div>
      <p class="muted tiny">If a member forgets their optional Profile PIN, you can remove the lock. The old PIN is never shown.</p>
      <div class="row-end"><button type="button" class="btn ghost" id="profile-pin-reset">Reset selected member's Profile PIN</button></div>
    </div>`;

  const form = root.querySelector("#commissioner-form");
  const member = root.querySelector("#commissioner-member");
  const pin = root.querySelector("#commissioner-pin");
  const pinHelp = root.querySelector("#commissioner-pin-help");
  const currentAccess = root.querySelector("#commissioner-current");
  const owner = root.querySelector("#commissioner-owner");
  const disable = root.querySelector("#commissioner-disable");
  const permissionInputs = [...root.querySelectorAll("#commissioner-perms input[type=checkbox]")];
  const recordForMember = () => accessByMember.get(String(member.value));
  const syncOwner = () => { permissionInputs.forEach(box => { box.disabled = owner.checked; }); };
  const syncMember = () => {
    const record = recordForMember();
    const permissions = new Set(record?.permissions || []);
    pin.value = "";
    owner.checked = Boolean(record?.is_owner);
    permissionInputs.forEach(box => { box.checked = permissions.has(box.value); });
    pin.required = accessEditorReady ? !record : true;
    pin.placeholder = record ? "Leave blank to keep current PIN" : "At least 4 digits";
    pinHelp.textContent = record ? "Leave this blank to keep the current commissioner PIN, or enter a new one to replace it." : "Set a PIN of at least four digits for new commissioner access.";
    currentAccess.textContent = !accessEditorReady ? "Current access unavailable until the database update is installed." : record?.active ? (record.is_owner ? "Current access: Owner · all permissions" : `Current access: Commissioner · ${record.permissions.length} permission${record.permissions.length === 1 ? "" : "s"}`) : record ? "Current access: Disabled · previous settings shown below" : "Current access: None";
    disable.disabled = accessEditorReady ? !record?.active : false;
    syncOwner();
  };
  member.addEventListener("change", syncMember);
  owner.addEventListener("change", syncOwner);
  pin.addEventListener("input", () => { pin.value = pin.value.replace(/\D/g, ""); });
  syncMember();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const existing = recordForMember();
      if (!existing && pin.value.length < 4) throw new Error("Set a PIN of at least four digits for new commissioner access.");
      const permissions = permissionInputs.filter(box => box.checked).map(box => box.value);
      const { error } = await db().rpc("save_commissioner", { target_member_id: Number(member.value), new_pin: pin.value, new_permissions: permissions, make_owner: owner.checked });
      if (error) throw error;
      accessByMember.set(String(member.value), { member_id: Number(member.value), is_owner: owner.checked, active: true, permissions });
      toast(owner.checked ? "Owner access updated" : "Commissioner access updated");
      syncMember();
    } catch (error) {
      const message = !pin.value && /PIN must be at least/i.test(error.message || "") ? "Run commissioner_access_editor_schema.sql in Supabase to edit access without resetting the PIN." : error.message;
      toast(message || "Could not save commissioner access", true);
    } finally { submit.disabled = false; }
  });

  disable.addEventListener("click", async () => {
    const chosen = members.find(item => String(item.id) === String(member.value));
    const name = chosen?.display_name || chosen?.team_name || "this member";
    if (!confirm(`Disable commissioner access for ${name}?`)) return;
    try {
      const { error } = await db().rpc("disable_commissioner", { target_member_id: Number(member.value) });
      if (error) throw error;
      const existing = recordForMember() || { member_id: Number(member.value), permissions: [], is_owner: false };
      accessByMember.set(String(member.value), { ...existing, active: false });
      toast("Commissioner access disabled");
      syncMember();
    } catch (error) { toast(error.message || "Could not disable commissioner access", true); }
  });

  root.querySelector("#profile-pin-reset").addEventListener("click", async () => {
    const chosen = members.find(item => String(item.id) === String(member.value));
    const name = chosen?.display_name || chosen?.team_name || "this member";
    if (!confirm(`Remove ${name}'s Profile PIN lock? They can set a new one from their Profile.`)) return;
    try {
      const { error } = await db().rpc("profile_owner_reset_pin", { target_member_id: Number(member.value) });
      if (error) throw error;
      toast("Profile PIN lock reset");
    } catch (error) {
      toast(/profile_owner_reset_pin|function/i.test(error.message || "") ? "Run profile_lock_schema.sql in Supabase first" : (error.message || "Could not reset Profile PIN"), true);
    }
  });
}
