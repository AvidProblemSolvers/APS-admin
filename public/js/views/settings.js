// 10. Settings — owner, admin. Reads and writes site_settings: the Razorpay Payment Button
// (Test / Live) and the scheduler's rules. Validation runs here for instant feedback and
// again, authoritatively, in admin-settings. No audit row is written by the admin for
// these changes: the database trigger on site_settings records them, attributed through
// updated_by.

import { html, raw } from "../lib/html.js";
import { can } from "../lib/panes.js";
import { dateTime } from "../lib/time.js";
import { SETTINGS, validateChanges } from "../shared/settings_schema.js";
import { publishStatus, runPublishPoll } from "./publish.js";

function field(def, state, edit) {
  const v = state.draft[def.key] ?? "";
  const err = state.errors[def.key];
  const meta = state.meta[def.key];
  const off = edit ? "" : raw(" disabled");
  const id = `s-${def.key}`;
  let control;
  if (def.kind === "enum") {
    control = html`<div class="seg" role="radiogroup" aria-labelledby="${id}-l">${def.options.map((o) => html`<button type="button" role="radio" aria-checked="${v === o}" aria-pressed="${v === o}" data-click="mode" data-v="${o}"${off}>${o.toUpperCase()}</button>`)}</div>`;
  } else {
    control = html`<input id="${id}" type="${def.kind === "number" ? "number" : "text"}" inputmode="${def.kind === "number" ? "numeric" : "text"}" name="${def.key}" value="${v}" placeholder="${def.placeholder ?? ""}" autocomplete="off" spellcheck="false" data-input="field" aria-invalid="${err ? "true" : "false"}" aria-describedby="${id}-h"${off}>`;
  }
  return html`<div class="field">
    <label class="label" id="${id}-l" for="${id}">${def.label}</label>
    ${control}
    <span class="error" data-error="${def.key}">${err ?? ""}</span>
    <span class="help" id="${id}-h">${def.help}${meta?.stored ? html` · last changed ${dateTime(meta.updated_at)} IST${meta.updated_by ? ` by ${meta.updated_by}` : ""}` : html` · default, not yet stored`}</span>
  </div>`;
}

export function changedKeys(state) {
  return Object.keys(state.draft).filter((k) => (state.draft[k] ?? "") !== (state.values[k] ?? ""));
}

function savebar(state, ctx) {
  const changed = changedKeys(state);
  const edit = can(ctx.role, "admin-settings.save");
  return html`<span class="${changed.length ? "warn-text" : "muted"}">${changed.length ? `${changed.length} unsaved` : "Saved."}</span>
    <span class="muted">Every change is recorded in the audit log automatically.</span>
    <span class="spacer"></span><span data-region="status">${publishStatus(state.publish)}</span>
    ${edit ? html`<button class="btn primary" type="button" data-click="save"${changed.length ? "" : raw(" disabled")}>Save</button>` : ""}
    ${edit && can(ctx.role, "trigger-publish.publish") ? html`<button class="btn publish" type="button" data-click="save-publish"${changed.length ? "" : raw(" disabled")}>SAVE &amp; PUBLISH</button>` : ""}`;
}

export default {
  id: "settings",
  initial: () => ({ errors: {}, publish: null }),
  load: async (ctx) => {
    const r = await ctx.api("admin-settings", { action: "get" });
    return { ...r, draft: { ...r.values }, errors: {} };
  },
  regions: { savebar, status: (s) => publishStatus(s.publish) },
  render(state, ctx) {
    const edit = can(ctx.role, "admin-settings.save");
    const live = state.values.razorpay_mode === "live";
    const groups = [...new Set(SETTINGS.map((s) => s.group))];
    return html`
      <div class="mode-banner ${live ? "live" : ""}">
        <span class="pill ${live ? "warn" : "ok"}">${live ? "LIVE" : "TEST"}</span>
        <span>The site's Book button is using the <strong>${live ? "Live" : "Test"}-mode</strong> Razorpay button${live ? " — real payments." : " — no real money moves."}</span>
      </div>
      ${groups.map((g) => html`<section class="group settings-group"><h2>${g}</h2>
        ${SETTINGS.filter((s) => s.group === g).map((def) => field(def, state, edit))}
      </section>`)}
      <div class="savebar" data-region="savebar">${savebar(state, ctx)}</div>`;
  },
  on: {
    "input:field"(el, pane) {
      const draft = { ...pane.state.draft, [el.name]: el.value };
      const { errors } = validateChanges(pane.state.values, Object.fromEntries(changedKeys({ ...pane.state, draft }).map((k) => [k, draft[k]])));
      for (const node of el.form?.querySelectorAll?.("[data-error]") ?? document.querySelectorAll("[data-error]")) {
        node.textContent = errors[node.dataset.error] ?? "";
      }
      el.setAttribute("aria-invalid", errors[el.name] ? "true" : "false");
      pane.patch({ draft, errors }, "savebar");
    },
    "click:mode"(btn, pane, ctx) {
      const v = btn.dataset.v;
      if (v === "live" && pane.state.draft.razorpay_mode !== "live" &&
        !ctx.confirm("Switch the site to the LIVE Razorpay button? Visitors will be charged real money.")) return;
      const draft = { ...pane.state.draft, razorpay_mode: v };
      const { errors } = validateChanges(pane.state.values, Object.fromEntries(changedKeys({ ...pane.state, draft }).map((k) => [k, draft[k]])));
      pane.set({ draft, errors });
    },
    "click:save": (_b, pane, ctx) => save(pane, ctx, false),
    "click:save-publish": (_b, pane, ctx) => save(pane, ctx, true),
  },
};

async function save(pane, ctx, publish) {
  const changes = Object.fromEntries(changedKeys(pane.state).map((k) => [k, pane.state.draft[k]]));
  const local = validateChanges(pane.state.values, changes);
  if (!local.ok) return pane.set({ errors: local.errors });
  try {
    const r = await ctx.api("admin-settings", { action: "save", changes, publish });
    pane.set({ ...r, draft: { ...r.values }, errors: {}, publish: r.publish });
    ctx.toast(`Saved ${r.updated.length} setting${r.updated.length === 1 ? "" : "s"}.${publish ? " Publishing…" : ""}`);
    if (r.publish) runPublishPoll(ctx, r.publish, (p) => pane.patch({ publish: p }, "status"));
  } catch (e) {
    if (e.body?.errors) return pane.set({ errors: e.body.errors });
    throw e;
  }
}
