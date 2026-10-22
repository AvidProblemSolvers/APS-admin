// 7. Traffic — all roles. Aggregates only. Single-series daily bar chart (one accent hue,
// no legend needed), per-bar hover titles, and the same numbers as a table.

import { html } from "../lib/html.js";
import { day } from "../lib/time.js";

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

export default {
  id: "traffic",
  initial: () => ({ days: 30 }),
  load: (ctx, state) => ctx.api("admin-traffic", { action: "summary", days: state?.days ?? 30 }),
  render(s) {
    return html`
      <div class="pane-head">
        <div class="seg" role="group" aria-label="Period">${[7, 30, 90].map((d) => html`<button type="button" data-click="days" data-days="${d}" aria-pressed="${s.days === d}">${d} DAYS</button>`)}</div>
        <span class="muted">Days are IST calendar days.</span>
      </div>
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
  on: {
    async "click:days"(btn, pane) {
      pane.set({ days: Number(btn.dataset.days) });
      await pane.reload();
    },
  },
};
