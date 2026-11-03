// 7. Traffic — all roles. Aggregates only. Single-series daily bar chart (one accent hue,
// no legend needed), per-bar hover titles, and the same numbers as a table.
// Period: 7 / 30 / 90 days, or CUSTOM with the FROM/TO fields Audit and Signals use. The
// period lives in the hash: #/traffic (30), #/traffic/7, #/traffic/custom/FROM/TO.

import { html } from "../lib/html.js";
import { dateFields, DATE_RE, istDayRange, rangeProblem } from "../lib/range.js";
import { day } from "../lib/time.js";

const PRESETS = [7, 30, 90];
const DEFAULT_DAYS = 30;

/** The part of the hash after #/traffic/ → { mode: 7 | 30 | 90 | "custom", from, to }. */
export function parsePeriod(sub) {
  const [kind, from = "", to = ""] = String(sub ?? "").split("/");
  if (kind === "custom") return { mode: "custom", from: DATE_RE.test(from) ? from : "", to: DATE_RE.test(to) ? to : "" };
  const days = Number(kind);
  return { mode: PRESETS.includes(days) ? days : DEFAULT_DAYS, from: "", to: "" };
}

/** The hash that reopens a period. */
export function periodHash(p) {
  if (p.mode !== "custom") return p.mode === DEFAULT_DAYS ? "#/traffic" : `#/traffic/${p.mode}`;
  return p.from && p.to ? `#/traffic/custom/${p.from}/${p.to}` : "#/traffic/custom";
}

/** Why this period cannot load ("" when it can). CUSTOM with no dates yet is not an error. */
const problem = (p) => (p.mode === "custom" && (p.from || p.to) ? rangeProblem(p.from, p.to) : "");
/** Whether this period is ready to fetch. */
const ready = (p) => p.mode !== "custom" || (p.from && p.to && !rangeProblem(p.from, p.to));
const same = (a, b) => a.mode === b.mode && (a.mode !== "custom" || (a.from === b.from && a.to === b.to));

/** Shows a period at once; fetches only if it is valid. `navigate` also records it in the hash. */
async function apply(pane, ctx, p, navigate) {
  const error = problem(p);
  const ok = ready(p);
  // A valid period keeps the old numbers on screen until the new ones land, as before.
  pane.set({ ...p, error, summary: ok ? pane.state.summary : null });
  if (!ok) return;
  if (navigate) ctx.navigate?.(periodHash(p));
  await pane.reload();
}

function change(cur, prev) {
  if (!prev) return cur ? html`<span class="muted">new</span>` : "";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return html`<span class="${pct >= 0 ? "ok-text" : "bad-text"}">${pct >= 0 ? "+" : ""}${pct}%</span> <span class="muted">vs prior</span>`;
}

export function barChart(daily) {
  // Drawn in a 1000×100 box stretched to the card; text lives in HTML below so it never scales.
  const W = 1000, H = 100, gap = 2;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const bw = Math.max(0.5, (W - gap * (daily.length - 1)) / daily.length);
  const ticks = [0, Math.floor((daily.length - 1) / 2), daily.length - 1];
  return html`<div class="chart">
    <svg class="bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Page views per day; peak ${max}">
      ${daily.map((d, i) => {
        const h = (d.count / max) * (H - 2);
        return html`<rect class="bar-mark" x="${(i * (bw + gap)).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}"><title>${day(`${d.date}T06:30:00Z`)}: ${d.count} views</title></rect>`;
      })}
      <line class="axis" x1="0" x2="${W}" y1="${H}" y2="${H}" vector-effect="non-scaling-stroke"></line>
    </svg>
    <div class="ticks muted num">${ticks.map((i) => html`<span>${day(`${daily[i].date}T06:30:00Z`)}</span>`)}</div>
    <p class="muted num">Peak ${max} views/day</p>
  </div>`;
}

function ranked(title, rows, highlight = []) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return html`<section class="card"><h2 class="label muted">${title}</h2>
    ${rows.length ? html`<div class="rank">${rows.map((r) => html`<div class="r">
      <span class="${highlight.includes(r.label) ? "ok-text" : ""}">${r.label}</span>
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" height="6" width="100%" aria-hidden="true"><rect class="bar-mark" x="0" y="0" height="6" rx="2" width="${Math.max(1, (r.count / max) * 100)}"></rect></svg>
      <span class="n num">${r.count}</span>
    </div>`)}</div>` : html`<p class="muted">None in this period.</p>`}
  </section>`;
}

function head(s) {
  return html`
      <div class="pane-head">
        <div class="seg" role="group" aria-label="Period">${PRESETS.map((d) => html`<button type="button" data-click="days" data-days="${d}" aria-pressed="${s.mode === d}">${d} DAYS</button>`)}<button type="button" data-click="custom" aria-pressed="${s.mode === "custom"}">CUSTOM</button></div>
        <span class="muted">Days are IST calendar days.</span>
      </div>
      ${s.mode === "custom" ? html`<form class="filters" data-submit="range" aria-label="Custom range">
        ${dateFields(s)}
        <button class="btn primary" type="submit">Apply</button>
      </form>
      ${s.error ? html`<p class="bad-text" role="alert" data-range-error>${s.error}</p>` : ""}` : ""}`;
}

export default {
  id: "traffic",
  initial: (ctx) => {
    const p = parsePeriod(ctx?.sub);
    return { ...p, error: problem(p), summary: null };
  },
  /** Only the default period is cached; a range opened from the hash always loads fresh. */
  cacheKey: (s) => (s.mode === DEFAULT_DAYS ? "traffic" : null),
  /** Nothing is fetched for an incomplete or refused range. */
  async load(ctx, state) {
    const p = state ?? parsePeriod("");
    if (!ready(p)) return { summary: null };
    const body = p.mode === "custom" ? { action: "summary", ...istDayRange(p.from, p.to) } : { action: "summary", days: p.mode };
    return { summary: await ctx.api("admin-traffic", body) };
  },
  render(state) {
    const s = state.summary;
    if (!s) {
      return html`${head(state)}${state.mode === "custom" && !state.error ? html`<p class="empty">Pick a FROM and a TO date, then Apply.</p>` : ""}`;
    }
    return html`${head(state)}
      ${state.mode === "custom" ? html`<p class="muted num">${day(`${state.from}T06:30:00Z`)} – ${day(`${state.to}T06:30:00Z`)} · ${s.days} day${s.days === 1 ? "" : "s"}, compared with the ${s.days} before</p>` : ""}
      <div class="stats">
        <div class="stat"><span class="label">Page views</span><span class="value num">${s.views}</span><span>${change(s.views, s.previous_views)}</span></div>
        <div class="stat"><span class="label">Sessions</span><span class="value num">${s.sessions}</span></div>
        ${s.ai.map((a) => html`<div class="stat accent"><span class="label">From ${a.label}</span><span class="value num">${a.count}</span><span>${change(a.count, a.previous)}</span></div>`)}
      </div>
      <section class="card">
        <h2 class="label muted">Views per day</h2>
        ${barChart(s.daily)}
        <details><summary class="muted">As a table</summary>
          <div class="table-wrap"><table><thead><tr><th>Date</th><th>Views</th></tr></thead><tbody>
            ${[...s.daily].reverse().map((d) => html`<tr><td class="num">${d.date}</td><td class="num">${d.count}</td></tr>`)}
          </tbody></table></div>
        </details>
      </section>
      <div class="grid-2">
        ${ranked("Referrers", s.referrers, ["Claude", "ChatGPT", "Perplexity"])}
        ${ranked("Countries", s.countries)}
        ${ranked("UTM campaigns", s.campaigns)}
        ${ranked("Top pages", s.paths)}
      </div>`;
  },
  /** Back/forward or an edited address: show the period the hash names. */
  async route(sub, pane, ctx) {
    const p = parsePeriod(sub);
    if (same(p, pane.state) && pane.state.summary) return;
    await apply(pane, ctx, p, false);
  },
  on: {
    async "click:days"(btn, pane, ctx) {
      await apply(pane, ctx, { ...pane.state, mode: Number(btn.dataset.days) }, true);
    },
    /** Reveals FROM/TO; reuses the last custom range if there was one. */
    async "click:custom"(_b, pane, ctx) {
      const p = { ...pane.state, mode: "custom" };
      if (!p.from || !p.to) {
        pane.set({ ...p, error: "", summary: null });
        return void ctx.navigate?.(periodHash(p));
      }
      await apply(pane, ctx, p, true);
    },
    async "submit:range"(form, pane, ctx) {
      const v = (name) => String(form.elements[name]?.value ?? "");
      await apply(pane, ctx, { mode: "custom", from: v("from"), to: v("to") }, true);
    },
  },
};
