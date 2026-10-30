// 4. Content — owner, admin. Every site_content key, nested by its dots: the first segment
// is the section tab, every later segment but the last is a heading, the last is the field.
// Labels come from the segments themselves. Live character counts. Save writes one audit
// row per changed field (server-side). Nothing reaches the live site until PUBLISH.

import { html, raw } from "../lib/html.js";
import { can } from "../lib/panes.js";
import { dateTime } from "../lib/time.js";
import { publishButton, publishStatus, runPublish } from "./publish.js";

/** "answers_index" → "Answers Index", "EMPTY_STATE" → "Empty State". */
export function humanize(segment) {
  const words = segment.split(/[_\-\s]+/).filter(Boolean);
  if (!words.length) return segment || "(blank)";
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Builds the section tree: [{ name, label, path, fields: rows, groups: [node] }], one node
 * per first segment. Depth is unbounded — a key with N dots sits N-1 headings deep.
 */
export function buildTree(rows) {
  const node = (name, path) => ({ name, label: humanize(name), path, fields: [], groups: new Map() });
  const tabs = new Map();
  for (const r of rows) {
    const segs = r.key.split(".");
    if (!tabs.has(segs[0])) tabs.set(segs[0], node(segs[0], [segs[0]]));
    let n = tabs.get(segs[0]);
    for (const s of segs.slice(1, -1)) {
      if (!n.groups.has(s)) n.groups.set(s, node(s, [...n.path, s]));
      n = n.groups.get(s);
    }
    n.fields.push(r);
  }
  const finish = (n) => ({
    ...n,
    fields: [...n.fields].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    groups: [...n.groups.values()].sort(byName).map(finish),
  });
  return [...tabs.values()].sort(byName).map(finish);
}

/** "answers_index.categories.buying.lead" → ["Answers Index", "Categories", "Buying"]. */
export const headingPath = (key) => {
  const segs = key.split(".");
  return segs.slice(0, Math.max(1, segs.length - 1)).map(humanize);
};

const fieldLabel = (key) => humanize(key.split(".").at(-1));
const tabHref = (name) => `#/content/${encodeURIComponent(name)}`;
const inTab = (key, name) => key === name || key.startsWith(`${name}.`);
const valueOf = (state, r) => state.edits[r.key] ?? r.value;
const rowsFor = (v) => Math.min(12, Math.max(1, Math.ceil(v.length / 90) + (v.match(/\n/g)?.length ?? 0)));

function field(state, r) {
  const v = valueOf(state, r);
  return html`<label class="content-field ${r.key in state.edits ? "changed" : ""}" data-key="${r.key}">
    <span class="row"><span class="fname">${fieldLabel(r.key)}</span><span class="count num" data-count="${r.key}">${v.length} chars</span></span>
    <span class="fkey">${r.key}</span>
    <textarea rows="${rowsFor(v)}" data-input="edit" data-key="${r.key}" maxlength="10000">${v}</textarea>
    <span class="muted">Updated ${dateTime(r.updated_at)} IST</span>
  </label>`;
}

/** Fields at this level first, then each nested group, indented one step per level. */
function branch(state, n, depth) {
  return html`${n.fields.map((r) => field(state, r))}
    ${n.groups.map((g) => html`<section class="cgroup" data-depth="${depth + 1}" data-path="${g.path.join(".")}">
      <div class="cg-head" role="heading" aria-level="${depth + 3}">${g.path.slice(1, -1).map((s) => html`<span class="crumb">${humanize(s)} ›</span> `)}${g.label}</div>
      ${branch(state, g, depth + 1)}
    </section>`)}`;
}

const currentTab = (tree, state) => tree.find((t) => t.name === state.tab) ?? tree[0];

function tabs(state) {
  const tree = buildTree(state.rows);
  const active = currentTab(tree, state);
  const keys = Object.keys(state.edits);
  return html`<nav class="subtabs" aria-label="Content sections">
    ${tree.map((t) => {
      const total = state.rows.filter((r) => inTab(r.key, t.name)).length;
      const dirty = keys.filter((k) => inTab(k, t.name)).length;
      return html`<a href="${tabHref(t.name)}" data-tab="${t.name}" data-click="section"${t === active && !state.q ? raw(' aria-current="page"') : ""}>${t.label}<span class="n num">${total}</span>${dirty ? html`<span class="dirty num" title="${dirty} unsaved">•${dirty}</span>` : ""}</a>`;
    })}
  </nav>`;
}

export function searchHits(state) {
  const q = (state.q ?? "").trim().toLowerCase();
  if (!q) return [];
  return state.rows.filter((r) => r.key.toLowerCase().includes(q) || valueOf(state, r).toLowerCase().includes(q));
}

function body(state) {
  if (state.q?.trim()) {
    const hits = searchHits(state);
    const sections = new Set(hits.map((r) => r.key.split(".")[0])).size;
    return html`<p class="muted num" data-hits="${hits.length}">${hits.length} match${hits.length === 1 ? "" : "es"}${hits.length ? ` in ${sections} section${sections === 1 ? "" : "s"}` : ""}</p>
      ${hits.map((r) => html`<div class="hit"><a class="hit-path" href="${tabHref(r.key.split(".")[0])}" data-click="section" data-hit-path="${headingPath(r.key).join(" › ")}">${headingPath(r.key).join(" › ")}</a>${field(state, r)}</div>`)}`;
  }
  const t = currentTab(buildTree(state.rows), state);
  return html`<div class="ctree" data-tab-body="${t.name}">${branch(state, t, 0)}</div>`;
}

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
  initial: (ctx) => ({ edits: {}, publish: null, q: "", tab: ctx?.sub || "" }),
  load: (ctx) => ctx.api("admin-content", { action: "list" }),
  regions: { savebar, tabs, body, status: (s) => publishStatus(s.publish) },
  render(state, ctx) {
    if (!state.rows.length) return html`<p class="empty">No site_content keys exist yet.</p>`;
    return html`
      <div class="content-search"><input type="search" data-input="search" value="${state.q}" placeholder="Search every section by key or text" aria-label="Search content"></div>
      <div data-region="tabs">${tabs(state)}</div>
      <div data-region="body">${body(state)}</div>
      <div class="savebar" data-region="savebar">${savebar(state, ctx)}</div>`;
  },
  /** #/content/<section> changed while the pane is open: switch tabs, keep unsaved edits. */
  route(sub, pane) {
    const search = pane.root.querySelector("[data-input=search]");
    if (search) search.value = "";
    if (!pane.state.rows) return void (pane.state.tab = sub);
    pane.patch({ tab: sub, q: "" }, "tabs", "body");
  },
  on: {
    /** A tab or a hit's path: the hash change switches section; the same hash still clears a search. */
    "click:section"(a, pane) {
      const href = a.getAttribute("href");
      if (location.hash !== href) location.hash = href;
      else pane.route(decodeURIComponent(href.slice("#/content/".length)));
    },
    "input:search"(el, pane) {
      pane.patch({ q: el.value }, "tabs", "body");
    },
    "input:edit"(el, pane) {
      const key = el.dataset.key;
      const original = pane.state.rows.find((r) => r.key === key).value;
      const edits = { ...pane.state.edits };
      if (el.value === original) delete edits[key];
      else edits[key] = el.value;
      const counter = el.closest("label").querySelector("[data-count]");
      counter.textContent = `${el.value.length} chars`;
      el.closest("label").classList.toggle("changed", key in edits);
      pane.patch({ edits }, "savebar", "tabs");
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
