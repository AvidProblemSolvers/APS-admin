// 1. Bookings — all roles. Revenue arrives from the server only for the owner; the UI
// additionally renders the revenue card, amount column and CSV export only for the owner.

import { html, raw } from "../lib/html.js";
import { can, canSee } from "../lib/panes.js";
import { ago, clock, dateTime, day, sameAsIst, tzAbbr, VIEWER_TZ } from "../lib/time.js";

const BRIEF = [
  ["problem", "What's the problem?"],
  ["already_tried", "Already tried"],
  ["how_measured", "How it's measured"],
  ["what_fixed_looks_like", "What fixed looks like"],
  ["who_involved", "Who else is involved"],
];

function money(byCurrency) {
  const entries = Object.entries(byCurrency || {});
  if (!entries.length) return "0";
  return entries.map(([c, v]) => new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(v)).join(" + ");
}

function slotCell(b) {
  if (!b.slot_start) return html`<span class="muted">—</span>`;
  const candidate = b.client_timezone || VIEWER_TZ;
  const other = sameAsIst(b.slot_start, candidate) ? null : candidate;
  return html`<span class="num">${day(b.slot_start)} ${clock(b.slot_start)} IST</span>${other
    ? html`<span class="sub num">${clock(b.slot_start, other)} ${tzAbbr(b.slot_start, other)} · ${b.client_timezone ? "client" : "you"}</span>`
    : ""}`;
}

function statusPill(b) {
  if (b.status === "captured" && b.scheduled) return html`<span class="pill ok">Scheduled</span>`;
  if (b.status === "captured") return html`<span class="pill warn">Paid · no slot</span>`;
  if (b.status === "cancelled" || b.status === "refunded" || b.status === "failed") return html`<span class="pill bad">${b.status}</span>`;
  return html`<span class="pill">${b.status}</span>`;
}

export function filterRows(rows, f) {
  const q = (f.q || "").trim().toLowerCase();
  return rows.filter((b) => {
    if (q && !`${b.payer_name ?? ""} ${b.payer_email ?? ""} ${b.heard_from ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.status && b.status !== f.status) return false;
    if (f.sched === "scheduled" && !b.scheduled) return false;
    if (f.sched === "unscheduled" && b.scheduled) return false;
    if (f.brief === "submitted" && !b.brief_submitted_at) return false;
    if (f.brief === "missing" && b.brief_submitted_at) return false;
    if (f.from && b.created_at < new Date(`${f.from}T00:00:00+05:30`).toISOString()) return false;
    if (f.to && b.created_at >= new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString()) return false;
    return true;
  });
}

const t = (iso) => (iso ? Date.parse(iso) : 0);
const paidOldest = (a, b) => t(a.created_at) - t(b.created_at);
const paidNewest = (a, b) => t(b.created_at) - t(a.created_at);

// The two groups that need someone to act come first, so they never hide among sessions
// that are already settled. Within a group: whatever is waiting longest, or happening next,
// is first. A row lands in the first group whose test it passes.
export const GROUPS = [
  { id: "requested", title: "Asked for other times", action: true, hint: "Waiting on an owner or admin",
    test: (b) => b.status === "captured" && !b.scheduled && b.pending_request, sort: paidOldest },
  { id: "unscheduled", title: "Paid · no time booked", action: true, hint: "Longest waiting first",
    test: (b) => b.status === "captured" && !b.scheduled, sort: paidOldest },
  { id: "upcoming", title: "Upcoming sessions", hint: "Soonest first",
    test: (b, now) => b.status === "captured" && b.scheduled && t(b.slot_start) > now, sort: (a, b) => t(a.slot_start) - t(b.slot_start) },
  { id: "past", title: "Past sessions", hint: "Most recent first",
    test: (b) => b.status === "captured" && b.scheduled, sort: (a, b) => t(b.slot_start) - t(a.slot_start) },
  { id: "other", title: "Not paid, cancelled or refunded", hint: "Newest first",
    test: () => true, sort: paidNewest },
];

/** [{ group, rows }] in GROUPS order, empty groups left out. */
export function groupRows(rows, now) {
  const buckets = GROUPS.map((group) => ({ group, rows: [] }));
  for (const b of rows) buckets.find((x) => x.group.test(b, now)).rows.push(b);
  return buckets.filter((x) => x.rows.length).map((x) => ({ group: x.group, rows: x.rows.sort(x.group.sort) }));
}

function detailRow(d, cols) {
  if (d === "loading") return html`<tr class="detail"><td colspan="${cols}"><span class="muted">Loading brief…</span></td></tr>`;
  if (!d) return "";
  const brief = d.brief;
  return html`<tr class="detail"><td colspan="${cols}"><div class="grid-2">
    <div class="brief">
      <h3 class="label muted">Project brief ${brief?.submitted_at ? html`<span class="pill ok">Submitted ${dateTime(brief.submitted_at)}</span>` : brief ? html`<span class="pill warn">Draft</span>` : ""}</h3>
      ${brief
        ? BRIEF.map(([k, q]) => brief[k] ? html`<div><p class="q">${q}</p><p class="a">${brief[k]}</p></div>` : "")
        : html`<p class="muted">No brief yet.</p>`}
      ${d.files?.length ? html`<div><p class="q">Files</p>${d.files.map((f) => html`<p>${f.url ? html`<a href="${f.url}" target="_blank" rel="noopener noreferrer">${f.name}</a>` : f.name}</p>`)}</div>` : ""}
    </div>
    <div class="brief">
      <h3 class="label muted">Probe text</h3>
      ${d.probes?.length
        ? d.probes.map((p) => html`<div>
            <p class="q">${dateTime(p.created_at)} · ${p.verdict || "no verdict"}</p>
            ${p.business_text ? html`<p class="a muted">The business: ${p.business_text}</p>` : ""}
            <p class="a">${p.problem_text}</p>
            ${p.goal_text ? html`<p class="a muted">Goal: ${p.goal_text}</p>` : ""}
          </div>`)
        : html`<p class="muted">No probe linked to this session.</p>`}
    </div>
  </div></td></tr>`;
}

function table(state, ctx) {
  const owner = can(ctx.role, "admin-bookings.revenue");
  const emailer = can(ctx.role, "admin-bookings.email_link");
  const rows = filterRows(state.rows, state.filters);
  const cols = owner ? 9 : 8;
  if (!rows.length) return html`<p class="empty">No bookings match.</p>`;
  const now = Date.parse(state.now) || Date.now();
  return html`<div class="table-wrap"><table class="stack">
    <thead><tr>
      <th>Paid</th><th>Name</th><th>Email</th>${owner ? html`<th>Amount</th>` : ""}<th>Slot</th><th>Status</th><th>Heard from</th><th>Brief</th><th><span class="sr-only">Actions</span></th>
    </tr></thead>
    ${groupRows(rows, now).map(({ group, rows: inGroup }) => html`<tbody data-group="${group.id}">
      <tr class="group-head${group.action ? " action" : ""}"><th colspan="${cols}" scope="colgroup">${group.title} <span class="num">${inGroup.length}</span><span class="hint">${group.id === "requested" && canSee(ctx.role, "slot-requests") ? html`<a href="#/slot-requests">Approve or decline on Slot requests</a>` : group.hint}</span></th></tr>
      ${inGroup.map((b) => html`
      <tr class="${b.flagged ? "flagged" : ""}">
        <td data-label="Paid" class="num">${dateTime(b.created_at)}${b.flagged ? html`<span class="sub warn-text">Unscheduled ${ago(b.created_at, now)}</span>` : ""}</td>
        <td data-label="Name">${b.payer_name || html`<span class="muted">—</span>`}</td>
        <td data-label="Email"><a href="mailto:${b.payer_email}">${b.payer_email}</a></td>
        ${owner ? html`<td data-label="Amount" class="num">${b.amount != null ? money({ [b.currency || "USD"]: b.amount }) : ""}</td>` : ""}
        <td data-label="Slot">${slotCell(b)}</td>
        <td data-label="Status">${statusPill(b)}${b.pending_request ? html` <span class="pill warn">Asked for other times</span>` : ""}</td>
        <td data-label="Heard from">${b.heard_from || html`<span class="muted">—</span>`}</td>
        <td data-label="Brief">${b.brief_submitted_at ? html`<span class="pill ok">Yes</span>` : html`<span class="pill">No</span>`}</td>
        <td class="actions">
          ${b.flagged && emailer ? html`<button class="btn small primary" type="button" data-click="email-link" data-id="${b.id}"${b.reminder_sent_at ? html` title="Last sent ${dateTime(b.reminder_sent_at)} IST"` : ""}>Email booking link</button> ` : ""}
          <button class="btn small" type="button" data-click="expand" data-id="${b.id}" aria-expanded="${state.open[b.id] ? "true" : "false"}">${state.open[b.id] ? "Hide" : "Brief"}</button>
        </td>
      </tr>
      ${state.open[b.id] ? detailRow(state.open[b.id], cols) : ""}`)}
    </tbody>`)}</table></div>`;
}

export default {
  id: "bookings",
  initial: () => ({ filters: {}, open: {} }),
  load: (ctx) => ctx.api("admin-bookings", { action: "list" }),
  regions: { table },
  render(state, ctx) {
    const s = state.stats;
    const owner = can(ctx.role, "admin-bookings.revenue");
    const statuses = [...new Set(state.rows.map((r) => r.status))].sort();
    return html`
      <div class="stats">
        <div class="stat"><span class="label">Total</span><span class="value num">${s.total}</span></div>
        <div class="stat"><span class="label">Upcoming</span><span class="value num">${s.upcoming}</span></div>
        <div class="stat accent"><span class="label">Paid but not scheduled</span><span class="value num">${s.paid_not_scheduled}</span></div>
        <div class="stat ${s.brief_missing ? "warn" : ""}"><span class="label">Brief missing</span><span class="value num">${s.brief_missing}</span></div>
        ${owner && s.revenue_month ? html`<div class="stat"><span class="label">Revenue this month</span><span class="value num hero">${money(s.revenue_month)}</span></div>` : ""}
      </div>
      <form class="filters" data-input="filter" data-change="filter" role="search">
        <label class="field"><span class="label">Search</span><input type="search" name="q" placeholder="Name, email, source" value="${state.filters.q ?? ""}"></label>
        <label class="field"><span class="label">Status</span><select name="status"><option value="">All</option>${statuses.map((x) => html`<option${state.filters.status === x ? raw(" selected") : ""}>${x}</option>`)}</select></label>
        <label class="field"><span class="label">Slot</span><select name="sched"><option value="">All</option><option value="scheduled">Scheduled</option><option value="unscheduled">Not scheduled</option></select></label>
        <label class="field"><span class="label">Brief</span><select name="brief"><option value="">All</option><option value="submitted">Submitted</option><option value="missing">Missing</option></select></label>
        <label class="field"><span class="label">Paid from</span><input type="date" name="from"></label>
        <label class="field"><span class="label">Paid to</span><input type="date" name="to"></label>
        <span class="spacer"></span>
        ${can(ctx.role, "admin-bookings.export_csv") ? html`<button class="btn" type="button" data-click="csv">Export CSV</button>` : ""}
      </form>
      <div data-region="table">${table(state, ctx)}</div>`;
  },
  on: {
    "input:filter": (form, pane) => pane.patch({ filters: Object.fromEntries(new FormData(form)) }, "table"),
    "change:filter": (form, pane) => pane.patch({ filters: Object.fromEntries(new FormData(form)) }, "table"),
    async "click:expand"(btn, pane, ctx) {
      const id = btn.dataset.id;
      const open = { ...pane.state.open };
      if (open[id]) {
        delete open[id];
        return pane.patch({ open }, "table");
      }
      pane.patch({ open: { ...open, [id]: "loading" } }, "table");
      const d = await ctx.api("admin-bookings", { action: "detail", booking_id: id });
      pane.patch({ open: { ...pane.state.open, [id]: d } }, "table");
    },
    async "click:email-link"(btn, pane, ctx) {
      const b = pane.state.rows.find((r) => r.id === btn.dataset.id);
      if (!ctx.confirm(`Email the booking link to ${b.payer_email}?`)) return;
      await ctx.api("admin-bookings", { action: "email_link", booking_id: b.id });
      ctx.toast(`Booking link sent to ${b.payer_email}.`);
      await pane.reload();
    },
    "click:csv": (_btn, _pane, ctx) => ctx.download("admin-bookings", { action: "export_csv" }),
  },
};
