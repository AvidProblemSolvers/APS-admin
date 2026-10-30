// 4. Content — owner, admin. Every site_content key, nested by its dots: the first segment
// is the section tab, every later segment but the last is a heading, the last is the field.
// Labels come from the segments themselves. Each heading's own fields are edited as ONE
// textarea, one "Label: value" line per field, parsed back into the individual keys on
// save; a field that cannot round-trip through one line is edited on its own. Order follows
// sort_order (the website's order) when the column exists, then the key. Save writes one
// audit row per changed field (server-side). Nothing reaches the live site until PUBLISH.

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

/** sort_order, or Infinity when it is null or the column does not exist (nulls last). */
const rank = (r) => (typeof r.sort_order === "number" && Number.isFinite(r.sort_order) ? r.sort_order : Infinity);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byField = (a, b) => rank(a) - rank(b) || byText(a.key, b.key);
const byNode = (a, b) => a.rank - b.rank || byText(a.name, b.name);

/**
 * Builds the section tree: [{ name, label, path, rank, fields: rows, groups: [node] }], one
 * node per first segment. Depth is unbounded — a key with N dots sits N-1 headings deep.
 * A node's rank is the lowest sort_order among every field under it.
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
  const finish = (n) => {
    const groups = [...n.groups.values()].map(finish).sort(byNode);
    const rankOf = Math.min(...n.fields.map(rank), ...groups.map((g) => g.rank));
    return { ...n, rank: rankOf, fields: [...n.fields].sort(byField), groups };
  };
  return [...tabs.values()].map(finish).sort(byNode);
}

/** Every node of the tree by its dotted path. */
function nodesByPath(tree, out = new Map()) {
  for (const n of tree) {
    out.set(n.path.join("."), n);
    nodesByPath(n.groups, out);
  }
  return out;
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
/** Rows to show every line without a scrollbar, before the browser measures it (see fit). */
const fitRows = (text) => text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 90)), 0);

// ---- one textarea per group -------------------------------------------------------------

/**
 * Which of a group's fields can sit on one "Label: value" line. A value with a line break,
 * a label with a colon, or two fields sharing a label cannot round-trip, so each such field
 * is edited on its own with the reason shown.
 */
export function splitGroup(fields, value) {
  const seen = new Map();
  for (const r of fields) seen.set(fieldLabel(r.key), (seen.get(fieldLabel(r.key)) ?? 0) + 1);
  const inline = [], alone = [];
  for (const r of fields) {
    const label = fieldLabel(r.key);
    const why = /[\r\n]/.test(value(r)) ? "Contains line breaks, which one line per field cannot hold."
      : label.includes(":") ? "Its label contains a colon."
      : seen.get(label) > 1 ? `Another field here is also labelled “${label}”.` : "";
    if (why) alone.push({ r, why });
    else inline.push(r);
  }
  return { inline, alone };
}

/** One "Label: value" line per field, in the group's order. */
export const groupText = (fields, value) => fields.map((r) => `${fieldLabel(r.key)}: ${value(r)}`).join("\n");

/**
 * Reads a group's textarea back into its keys. The label is everything before the first
 * colon; the value is everything after it, less one space. Blank lines are ignored. An
 * unknown, repeated or missing label — or a line with no label — returns errors and no
 * values at all, so a typo can never drop or invent a key.
 */
export function parseGroup(text, fields) {
  const byLabel = new Map(fields.map((r) => [fieldLabel(r.key), r]));
  const values = {}, errors = [];
  text.split(/\r\n|\r|\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const at = line.indexOf(":");
    if (at < 0) return void errors.push(`Line ${i + 1} has no “Label:” — “${line.length > 40 ? `${line.slice(0, 40)}…` : line}”.`);
    const label = line.slice(0, at).trim();
    const r = byLabel.get(label);
    if (!r) return void errors.push(`“${label}” is not a field in this group.`);
    if (r.key in values) return void errors.push(`“${label}” appears more than once.`);
    const v = line.slice(at + 1);
    values[r.key] = v.startsWith(" ") ? v.slice(1) : v;
    if (!values[r.key].trim() && values[r.key] !== r.value) errors.push(`“${label}” is empty — the site never shows empty copy.`);
  });
  for (const [label, r] of byLabel) if (!(r.key in values)) errors.push(`“${label}” is missing.`);
  return errors.length ? { values: null, errors } : { values, errors };
}

/** The pane state after typing `text` into group `path`'s textarea. */
export function applyGroup(state, path, text) {
  const n = nodesByPath(buildTree(state.rows)).get(path);
  const { inline } = splitGroup(n.fields, (r) => valueOf(state, r));
  const edits = { ...state.edits }, drafts = { ...state.drafts };
  for (const r of inline) delete edits[r.key];
  const { values } = parseGroup(text, inline);
  if (!values) drafts[path] = text;
  else {
    delete drafts[path];
    for (const r of inline) if (values[r.key] !== r.value) edits[r.key] = values[r.key];
  }
  return { edits, drafts };
}

/** What Save sends: every edit except those in a group whose text does not parse. */
export function pendingChanges(state) {
  const nodes = nodesByPath(buildTree(state.rows));
  const held = new Set();
  for (const path of Object.keys(state.drafts ?? {})) {
    const n = nodes.get(path);
    if (n) for (const r of splitGroup(n.fields, (x) => valueOf(state, x)).inline) held.add(r.key);
  }
  const changes = Object.fromEntries(Object.entries(state.edits).filter(([k]) => !held.has(k)));
  return { changes, held: Object.keys(state.drafts ?? {}).length };
}

const errorList = (errors) => (errors.length ? html`<ul>${errors.map((e) => html`<li>${e}</li>`)}</ul>` : "");

/** Sizes a textarea to its content: no inner scrollbar. Assigning .style is CSSOM, allowed by the CSP. */
function fit(el) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

// A literal newline follows each <textarea> start tag: HTML drops exactly one there, so a
// value that itself begins with a newline survives the round trip.
function field(state, r, updated = true) {
  const v = valueOf(state, r);
  return html`<label class="content-field ${r.key in state.edits ? "changed" : ""}" data-key="${r.key}">
    <span class="row"><span class="fname">${fieldLabel(r.key)}</span><span class="count num" data-count="${r.key}">${v.length} chars</span></span>
    <span class="fkey">${r.key}</span>
    <textarea${updated ? raw(` rows="${rowsFor(v)}"`) : raw(` class="autosize" rows="${fitRows(v)}"`)} data-input="edit" data-key="${r.key}" maxlength="10000">
${v}</textarea>
    ${updated ? html`<span class="muted">Updated ${dateTime(r.updated_at)} IST</span>` : ""}
  </label>`;
}

/** A heading's own fields: one textarea of "Label: value" lines, then any that cannot be a line. */
function fieldsBlock(state, n) {
  if (!n.fields.length) return "";
  const path = n.path.join(".");
  const value = (r) => valueOf(state, r);
  const { inline, alone } = splitGroup(n.fields, value);
  const text = state.drafts[path] ?? groupText(inline, value);
  const errors = path in state.drafts ? parseGroup(text, inline).errors : [];
  const latest = n.fields.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
  const changed = path in state.drafts || inline.some((r) => r.key in state.edits);
  return html`<div class="cfields${changed ? " changed" : ""}" data-fields="${path}">
    <div class="cf-meta"><span class="num">${n.fields.length} field${n.fields.length === 1 ? "" : "s"}</span><span class="muted">Updated ${dateTime(latest)} IST</span></div>
    <div class="cf-errors" data-errors="${path}" aria-live="polite">${errorList(errors)}</div>
    ${inline.length ? html`<textarea class="autosize" rows="${fitRows(text)}" data-input="group" data-group="${path}" data-keys="${JSON.stringify(inline.map((r) => r.key))}" aria-label="${n.label}: one line per field"${errors.length ? raw(' aria-invalid="true"') : ""}>
${text}</textarea>
    <p class="fkeys">${inline.map((r) => html`<span>${r.key}</span> `)}</p>` : ""}
    ${alone.map(({ r, why }) => html`<div class="alone" data-alone="${r.key}"><p class="note muted">${why} Edited on its own:</p>${field(state, r, false)}</div>`)}
  </div>`;
}

/** Own fields first, then each nested group, indented one step per level. */
function branch(state, n, depth) {
  return html`${fieldsBlock(state, n)}
    ${n.groups.map((g) => html`<section class="cgroup" data-depth="${depth + 1}" data-path="${g.path.join(".")}">
      <div class="cg-head" role="heading" aria-level="${depth + 3}">${g.path.slice(1, -1).map((s) => html`<span class="crumb">${humanize(s)} ›</span> `)}${g.label}</div>
      ${branch(state, g, depth + 1)}
    </section>`)}`;
}

const currentTab = (tree, state) => tree.find((t) => t.name === state.tab) ?? tree[0];

function tabs(state) {
  const tree = buildTree(state.rows);
  const active = currentTab(tree, state);
  const keys = [...Object.keys(state.edits), ...Object.keys(state.drafts)];
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
  const { changes, held } = pendingChanges(state);
  const n = Object.keys(changes).length;
  return html`<span class="${n ? "warn-text" : "muted"}">${n ? `${n} unsaved change${n === 1 ? "" : "s"}` : held ? "Nothing to save yet." : "All changes saved."}</span>
    ${held ? html`<span class="bad-text" data-held="${held}">${held} group${held === 1 ? " has" : "s have"} errors and will not save.</span>` : ""}
    <span class="muted">Saved edits are not live until you publish.</span>
    <span class="spacer"></span>
    <span data-region="status">${publishStatus(state.publish)}</span>
    ${n || held ? html`<button class="btn" type="button" data-click="discard">Discard</button>` : ""}
    ${can(ctx.role, "admin-content.save") ? html`<button class="btn primary" type="button" data-click="save"${n ? "" : raw(" disabled")}>Save ${n || ""}</button>` : ""}
    ${can(ctx.role, "trigger-publish.publish") ? publishButton(n > 0) : ""}`;
}

export default {
  id: "content",
  initial: (ctx) => ({ edits: {}, drafts: {}, publish: null, q: "", tab: ctx?.sub || "" }),
  load: (ctx) => ctx.api("admin-content", { action: "list" }),
  regions: { savebar, tabs, body, status: (s) => publishStatus(s.publish) },
  /** After every paint: grow each group textarea to its content. */
  after(root) {
    for (const t of root.querySelectorAll("textarea.autosize")) fit(t);
  },
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
      if (el.classList.contains("autosize")) fit(el);
      pane.patch({ edits }, "savebar", "tabs");
    },
    /** A group textarea: parse on every keystroke; errors show above it and hold its save. */
    "input:group"(el, pane) {
      const path = el.dataset.group;
      pane.patch(applyGroup(pane.state, path, el.value), "savebar", "tabs");
      const inline = JSON.parse(el.dataset.keys);
      const errors = path in pane.state.drafts ? parseGroup(el.value, pane.state.rows.filter((r) => inline.includes(r.key))).errors : [];
      const box = [...pane.root.querySelectorAll("[data-errors]")].find((b) => b.dataset.errors === path);
      if (box) box.innerHTML = String(errorList(errors));
      if (errors.length) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
      el.closest(".cfields")?.classList.toggle("changed", path in pane.state.drafts || inline.some((k) => k in pane.state.edits));
      fit(el);
    },
    "click:discard"(_b, pane, ctx) {
      if (ctx.confirm("Discard all unsaved changes?")) pane.set({ edits: {}, drafts: {} });
    },
    async "click:save"(_b, pane, ctx) {
      const { changes, held } = pendingChanges(pane.state);
      if (!Object.keys(changes).length) return void ctx.toast("Nothing saved: fix the errors shown above the group.", true);
      const res = await ctx.api("admin-content", { action: "save", changes });
      const edits = Object.fromEntries(Object.entries(pane.state.edits).filter(([k]) => !(k in changes)));
      pane.set({ rows: res.rows, edits });
      const saved = `Saved ${res.updated.length} field${res.updated.length === 1 ? "" : "s"}.`;
      if (held) ctx.toast(`${saved} ${held} group${held === 1 ? "" : "s"} not saved: fix the errors shown.`, true);
      else ctx.toast(`${saved} Press PUBLISH to put them live.`);
    },
    async "click:publish"(_b, pane, ctx) {
      const { changes, held } = pendingChanges(pane.state);
      const n = Object.keys(changes).length + held;
      if (n && !ctx.confirm(`${n} unsaved change${n === 1 ? " is" : "s are"} not included. Publish what is saved?`)) return;
      if (!n && !ctx.confirm("Rebuild and publish the live site now?")) return;
      await runPublish(ctx, (p) => pane.patch({ publish: p }, "status"));
    },
  },
};
