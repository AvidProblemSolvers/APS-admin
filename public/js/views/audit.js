// 9. Audit — owner only. Reverse-chronological, before/after diffs, filters, CSV.
// READ-ONLY: this view renders no edit control, no delete control, no input bound to a
// row. The server has no such action either (admin-audit: list, export_csv).

import { html } from "../lib/html.js";
import { dateTime } from "../lib/time.js";
import { can } from "../lib/panes.js";

function pretty(v) {
  if (v === null || v === undefined) return "";
  try {
    const parsed = JSON.parse(v);
    if (parsed && typeof parsed === "object") return JSON.stringify(parsed, null, 2);
  } catch { /* plain text */ }
  return String(v);
}

/** Word-level diff (LCS). Falls back to whole values when either side is large. */
export function diffWords(a, b) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  if (A.length * B.length > 250_000) return { old: [[a, true]], new: [[b, true]] };
  const m = A.length, n = B.length;
  const L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const o = [], w = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { o.push([A[i], false]); w.push([B[j], false]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) o.push([A[i++], true]);
    else w.push([B[j++], true]);
  }
  while (i < m) o.push([A[i++], true]);
  while (j < n) w.push([B[j++], true]);
  return { old: o, new: w };
}

function diff(row) {
  const a = pretty(row.old_value), b = pretty(row.new_value);
  if (!a && !b) return "";
  const d = diffWords(a, b);
  return html`<div class="diff">
    <div class="old"><span class="head">Before</span>${a ? d.old.map(([t, c]) => (c && t.trim() ? html`<del>${t}</del>` : t)) : html`<span class="muted">—</span>`}</div>
    <div class="new"><span class="head">After</span>${b ? d.new.map(([t, c]) => (c && t.trim() ? html`<ins>${t}</ins>` : t)) : html`<span class="muted">—</span>`}</div>
  </div>`;
}

function filters(f) {
  const out = {};
  if (f.action_prefix) out.action_prefix = f.action_prefix;
  if (f.actor) out.actor = f.actor;
  if (f.q) out.q = f.q;
  if (f.from) out.from = new Date(`${f.from}T00:00:00+05:30`).toISOString();
  if (f.to) out.to = new Date(Date.parse(`${f.to}T00:00:00+05:30`) + 86_400_000).toISOString();
  return out;
}

export default {
  id: "audit",
  initial: () => ({ filters: {} }),
  load: (ctx, state) => ctx.api("admin-audit", { action: "list", ...filters(state?.filters ?? {}) }),
  render(state, ctx) {
    const f = state.filters;
    return html`
      <form class="filters" data-submit="filter" role="search">
        <label class="field"><span class="label">Action</span><select name="action_prefix"><option value="">All</option>${state.families.map((x) => html`<option${f.action_prefix === x ? html` selected` : ""}>${x}</option>`)}</select></label>
        <label class="field"><span class="label">Actor</span><input type="search" name="actor" value="${f.actor ?? ""}" placeholder="email contains"></label>
        <label class="field"><span class="label">Target</span><input type="search" name="q" value="${f.q ?? ""}" placeholder="key, slug, id"></label>
        <label class="field"><span class="label">From</span><input type="date" name="from" value="${f.from ?? ""}"></label>
        <label class="field"><span class="label">To</span><input type="date" name="to" value="${f.to ?? ""}"></label>
        <button class="btn primary" type="submit">Apply</button>
        <span class="spacer"></span>
        ${can(ctx.role, "admin-audit.export_csv") ? html`<button class="btn" type="button" data-click="csv">Export CSV</button>` : ""}
      </form>
      <p class="muted num">${state.total} entr${state.total === 1 ? "y" : "ies"} · append-only — entries cannot be edited or removed by anyone.</p>
      ${state.rows.length ? html`<div class="table-wrap"><table class="stack">
        <thead><tr><th>When (IST)</th><th>Actor</th><th>Action</th><th>Change</th></tr></thead>
        <tbody>${state.rows.map((r) => html`<tr>
          <td data-label="When" class="num">${dateTime(r.created_at)}${r.actor_country ? html`<span class="sub">${r.actor_country}</span>` : ""}</td>
          <td data-label="Actor">${r.actor_email}</td>
          <td data-label="Action"><span class="pill">${r.action}</span>${r.target ? html`<span class="sub">${r.target}</span>` : ""}</td>
          <td data-label="Change">${diff(r)}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<p class="empty">No entries match.</p>`}
      ${state.rows.length < state.total ? html`<button class="btn" type="button" data-click="more">Load more</button>` : ""}`;
  },
  on: {
    async "submit:filter"(form, pane) {
      pane.set({ filters: Object.fromEntries([...new FormData(form)].filter(([, v]) => v)) });
      await pane.reload();
    },
    async "click:more"(_b, pane, ctx) {
      const res = await ctx.api("admin-audit", { action: "list", offset: pane.state.rows.length, ...filters(pane.state.filters) });
      pane.set({ rows: [...pane.state.rows, ...res.rows], total: res.total });
    },
    "click:csv": (_b, pane, ctx) => ctx.download("admin-audit", { action: "export_csv", ...filters(pane.state.filters) }),
  },
};
