// 6. Signals — all roles. probe_queries as a readable list, not a table. No personal data.

import { html, raw } from "../lib/html.js";
import { dateTime } from "../lib/time.js";

const VERDICT_TONE = { fit: "ok", not_fit: "bad", unclear: "warn" };

function item(s) {
  return html`<article class="signal">
    ${s.business_text ? html`<p class="extra">The business: ${s.business_text}</p>` : ""}
    <p class="problem">${s.problem_text}</p>
    ${s.goal_text ? html`<p class="extra">Goal: ${s.goal_text}</p>` : ""}
    <p class="meta">
      <span class="num">${dateTime(s.created_at)} IST</span>
      ${s.verdict ? html`<span class="pill ${VERDICT_TONE[s.verdict] ?? ""}">${s.verdict.replace(/_/g, " ")}</span>` : ""}
      ${s.country ? html`<span>${s.country}</span>` : ""}
      ${s.referrer ? html`<span>via ${s.referrer}</span>` : ""}
      ${s.converted ? html`<span class="pill solid">Converted</span>` : ""}
    </p>
  </article>`;
}

function query(f, offset = 0) {
  const q = { action: "list", offset };
  if (f.verdict) q.verdict = f.verdict;
  if (f.converted === "yes") q.converted = true;
  if (f.converted === "no") q.converted = false;
  if (f.country) q.country = f.country;
  if (f.from) q.from = new Date(`${f.from}T00:00:00+05:30`).toISOString();
  if (f.to) q.to = new Date(Date.parse(`${f.to}T00:00:00+05:30`) + 86_400_000).toISOString();
  if (f.q) q.q = f.q;
  return q;
}

const sel = (cur, v) => (cur === v ? raw(" selected") : "");

export default {
  id: "signals",
  initial: () => ({ filters: {} }),
  load: (ctx, state) => ctx.api("admin-signals", query(state?.filters ?? {})),
  render(state) {
    const f = state.filters;
    const { facets } = state;
    return html`
      <div class="pane-head">
        <div class="seg" role="group" aria-label="View">
          <button type="button" data-click="converted-only" aria-pressed="${f.converted !== "yes"}" data-v="">ALL ${facets.all}</button>
          <button type="button" data-click="converted-only" aria-pressed="${f.converted === "yes"}" data-v="yes">CONVERTED ONLY ${facets.converted}</button>
        </div>
        <span class="muted">Converted = that session later paid. These are the problems that turn into hours.</span>
      </div>
      <form class="filters" data-submit="filter" role="search">
        <label class="field"><span class="label">Search problem text</span><input type="search" name="q" value="${f.q ?? ""}" maxlength="200"></label>
        <label class="field"><span class="label">Verdict</span><select name="verdict"><option value="">All</option>${facets.verdicts.map((v) => html`<option value="${v}"${sel(f.verdict, v)}>${v.replace(/_/g, " ")}</option>`)}</select></label>
        <label class="field"><span class="label">Converted</span><select name="converted"><option value="">All</option><option value="yes"${sel(f.converted, "yes")}>Yes</option><option value="no"${sel(f.converted, "no")}>No</option></select></label>
        <label class="field"><span class="label">Country</span><select name="country"><option value="">All</option>${facets.countries.map((c) => html`<option${sel(f.country, c)}>${c}</option>`)}</select></label>
        <label class="field"><span class="label">From</span><input type="date" name="from" value="${f.from ?? ""}"></label>
        <label class="field"><span class="label">To</span><input type="date" name="to" value="${f.to ?? ""}"></label>
        <button class="btn primary" type="submit">Apply</button>
        <button class="btn" type="button" data-click="clear">Clear</button>
      </form>
      <p class="muted num">${state.total} signal${state.total === 1 ? "" : "s"}</p>
      ${state.rows.length ? html`<div class="signals">${state.rows.map(item)}</div>` : html`<p class="empty">Nothing matches.</p>`}
      ${state.rows.length < state.total ? html`<button class="btn" type="button" data-click="more">Load more</button>` : ""}`;
  },
  on: {
    async "submit:filter"(form, pane) {
      pane.set({ filters: Object.fromEntries([...new FormData(form)].filter(([, v]) => v)) });
      await pane.reload();
    },
    async "click:converted-only"(btn, pane) {
      pane.set({ filters: { ...pane.state.filters, converted: btn.dataset.v || undefined } });
      await pane.reload();
    },
    async "click:clear"(_b, pane) {
      pane.set({ filters: {} });
      await pane.reload();
    },
    async "click:more"(_b, pane, ctx) {
      const res = await ctx.api("admin-signals", query(pane.state.filters, pane.state.rows.length));
      pane.set({ rows: [...pane.state.rows, ...res.rows], total: res.total });
    },
  },
};
