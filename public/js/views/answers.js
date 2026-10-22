// 5. Answers — owner, admin. List, create and edit answer pages. Warns when the summary
// falls outside 40–60 words: that paragraph is what answer engines quote.

import { html, raw } from "../lib/html.js";
import { can } from "../lib/panes.js";
import { dateTime } from "../lib/time.js";
import { publishStatus, runPublishPoll } from "./publish.js";

export const words = (s) => (s || "").trim() ? s.trim().split(/\s+/).length : 0;
export const slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

const BLANK = { id: null, title: "", slug: "", question: "", summary: "", body_md: "", related: [], published: false };

export function summaryNote(n) {
  if (n >= 40 && n <= 60) return html`<span class="count num">${n} words · in range</span>`;
  return html`<span class="count warn num">${n} words · aim for 40–60 — answer engines quote this paragraph</span>`;
}

function editor(state, ctx) {
  const a = state.draft;
  const edit = can(ctx.role, "admin-answers.save");
  const off = edit ? "" : raw(" disabled");
  return html`<form class="editor" data-submit="save" data-input="draft">
    <div class="pane-head"><h2>${a.id ? a.title || "Untitled" : "New answer"}</h2>${a.id ? html`<span class="muted">Updated ${dateTime(a.updated_at)} IST</span>` : ""}</div>
    <label class="field"><span class="label">Title</span><input type="text" name="title" required maxlength="200" value="${a.title}"${off}></label>
    <div class="row2">
      <label class="field"><span class="label">Slug</span><input type="text" name="slug" required maxlength="120" pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${a.slug}"${off}><span class="help">/answers/${a.slug || "…"}</span></label>
      <label class="field"><span class="label">Question it answers</span><input type="text" name="question" maxlength="300" value="${a.question ?? ""}"${off}></label>
    </div>
    <label class="field"><span class="label">Summary</span><textarea name="summary" rows="4" required maxlength="1200"${off}>${a.summary}</textarea><span data-region="summary">${summaryNote(words(a.summary))}</span></label>
    <label class="field"><span class="label">Body (Markdown)</span><textarea name="body_md" rows="18" required${off}>${a.body_md}</textarea><span class="count num" data-region="body">${words(a.body_md)} words</span></label>
    <label class="field"><span class="label">Related slugs</span><input type="text" name="related" value="${(a.related || []).join(", ")}" placeholder="comma, separated, slugs"${off}></label>
    <label><input type="checkbox" name="published"${a.published ? raw(" checked") : ""}${off}> Published</label>
    ${edit ? html`<div class="pane-head"><button class="btn primary" type="submit">${a.id ? "Save answer" : "Create answer"}</button>
      <span class="muted">Saving a published answer rebuilds the site.</span><span data-region="status">${publishStatus(state.publish)}</span></div>` : ""}
  </form>`;
}

export default {
  id: "answers",
  initial: () => ({ draft: { ...BLANK }, publish: null }),
  load: (ctx) => ctx.api("admin-answers", { action: "list" }),
  regions: {
    summary: (s) => summaryNote(words(s.draft.summary)),
    body: (s) => `${words(s.draft.body_md)} words`,
    status: (s) => publishStatus(s.publish),
  },
  render(state, ctx) {
    return html`<div class="split">
      <div class="group">
        ${can(ctx.role, "admin-answers.save") ? html`<button class="btn" type="button" data-click="new">+ New answer</button>` : ""}
        <nav class="answer-list" aria-label="Answers">${state.rows.length ? state.rows.map((a) => html`
          <button type="button" data-click="open" data-id="${a.id}" aria-current="${state.draft.id === a.id}">
            <span>${a.title}</span>
            <span class="muted">${a.published ? html`<span class="pill ok">Live</span>` : html`<span class="pill">Draft</span>`} ${(words(a.summary) < 40 || words(a.summary) > 60) ? html`<span class="pill warn">Summary ${words(a.summary)}w</span>` : ""}</span>
          </button>`) : html`<p class="empty">No answers yet.</p>`}</nav>
      </div>
      ${editor(state, ctx)}
    </div>`;
  },
  on: {
    "click:new": (_b, pane) => pane.set({ draft: { ...BLANK }, publish: null }),
    "click:open"(btn, pane) {
      const a = pane.state.rows.find((x) => x.id === btn.dataset.id);
      pane.set({ draft: { ...a }, publish: null });
    },
    "input:draft"(form, pane, _ctx, e) {
      const d = { ...pane.state.draft };
      const t = e.target;
      if (t.name === "related") d.related = t.value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (t.name === "published") d.published = t.checked;
      else d[t.name] = t.value;
      if (t.name === "title" && !d.id && (!pane.state.draft.slug || pane.state.draft.slug === slugify(pane.state.draft.title))) {
        d.slug = slugify(t.value);
        form.elements.slug.value = d.slug;
      }
      pane.patch({ draft: d }, "summary", "body");
    },
    async "submit:save"(form, pane, ctx) {
      const d = { ...pane.state.draft, published: form.elements.published.checked };
      const res = await ctx.api("admin-answers", {
        action: "save", id: d.id || undefined, title: d.title, slug: d.slug, question: d.question,
        summary: d.summary, body_md: d.body_md, related: d.related || [], published: d.published,
      });
      const list = await ctx.api("admin-answers", { action: "list" });
      pane.set({ rows: list.rows, draft: { ...res.answer }, publish: res.publish });
      ctx.toast([res.changed.length ? "Saved." : "No changes.", ...res.warnings].join(" "), res.warnings.length > 0);
      if (res.publish) runPublishPoll(ctx, res.publish, (p) => pane.patch({ publish: p }, "status"));
    },
  },
};
