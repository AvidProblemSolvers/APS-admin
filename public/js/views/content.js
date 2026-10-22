// 4. Content — owner, admin. Every site_content key, grouped by station (the key prefix),
// live character counts. Save writes one audit row per changed field (server-side).
// Nothing reaches the live site until PUBLISH.

import { html, raw } from "../lib/html.js";
import { can } from "../lib/panes.js";
import { dateTime } from "../lib/time.js";
import { publishButton, publishStatus, runPublish } from "./publish.js";

export function groupKeys(rows) {
  const groups = new Map();
  for (const r of rows) {
    const g = r.key.includes(".") ? r.key.split(".")[0] : r.key.includes("_") ? r.key.split("_")[0] : "other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  return [...groups.entries()];
}

const rowsFor = (v) => Math.min(12, Math.max(1, Math.ceil(v.length / 90) + (v.match(/\n/g)?.length ?? 0)));

function savebar(state, ctx) {
  const n = Object.keys(state.edits).length;
  return html`<span class="${n ? "warn-text" : "muted"}">${n ? `${n} unsaved change${n === 1 ? "" : "s"}` : "All changes saved."}</span>
    <span class="muted">Saved edits are not live until you publish.</span>
    <span class="spacer"></span>
    <span data-region="status">${publishStatus(state.publish)}</span>
    ${n ? html`<button class="btn" type="button" data-click="discard">Discard</button>` : ""}
    ${can(ctx.role, "admin-content.save") ? html`<button class="btn primary" type="button" data-click="save"${n ? "" : raw(" disabled")}>Save ${n || ""}</button>` : ""}
    ${can(ctx.role, "trigger-publish.publish") ? publishButton(n > 0) : ""}`;
}

export default {
  id: "content",
  initial: () => ({ edits: {}, publish: null }),
  load: (ctx) => ctx.api("admin-content", { action: "list" }),
  regions: { savebar, status: (s) => publishStatus(s.publish) },
  render(state, ctx) {
    if (!state.rows.length) return html`<p class="empty">No site_content keys exist yet.</p>`;
    return html`
      ${groupKeys(state.rows).map(([group, rows]) => html`<section class="group">
        <h2 class="label">${group}</h2>
        ${rows.map((r) => {
          const v = state.edits[r.key] ?? r.value;
          return html`<label class="content-field ${r.key in state.edits ? "changed" : ""}" data-key="${r.key}">
            <span class="row"><span class="label muted">${r.key}</span><span class="count num" data-count="${r.key}">${v.length} chars</span></span>
            <textarea rows="${rowsFor(v)}" data-input="edit" data-key="${r.key}" maxlength="10000">${v}</textarea>
            <span class="muted">Updated ${dateTime(r.updated_at)} IST</span>
          </label>`;
        })}
      </section>`)}
      <div class="savebar" data-region="savebar">${savebar(state, ctx)}</div>`;
  },
  on: {
    "input:edit"(el, pane) {
      const key = el.dataset.key;
      const original = pane.state.rows.find((r) => r.key === key).value;
      const edits = { ...pane.state.edits };
      if (el.value === original) delete edits[key];
      else edits[key] = el.value;
      const counter = el.closest("label").querySelector("[data-count]");
      counter.textContent = `${el.value.length} chars`;
      el.closest("label").classList.toggle("changed", key in edits);
      pane.patch({ edits }, "savebar");
    },
    "click:discard"(_b, pane, ctx) {
      if (ctx.confirm("Discard all unsaved changes?")) pane.set({ edits: {} });
    },
    async "click:save"(_b, pane, ctx) {
      const res = await ctx.api("admin-content", { action: "save", changes: pane.state.edits });
      pane.set({ rows: res.rows, edits: {} });
      ctx.toast(`Saved ${res.updated.length} field${res.updated.length === 1 ? "" : "s"}. Press PUBLISH to put them live.`);
    },
    async "click:publish"(_b, pane, ctx) {
      const n = Object.keys(pane.state.edits).length;
      if (n && !ctx.confirm(`${n} unsaved change${n === 1 ? " is" : "s are"} not included. Publish what is saved?`)) return;
      if (!n && !ctx.confirm("Rebuild and publish the live site now?")) return;
      await runPublish(ctx, (p) => pane.patch({ publish: p }, "status"));
    },
  },
};
