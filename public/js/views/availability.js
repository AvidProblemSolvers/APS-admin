// 3. Availability — owner, admin. Weekly grid (availability_rules), date overrides
// (slot_overrides), and the next N days exactly as a visitor would see them.

import { html, raw } from "../lib/html.js";
import { can } from "../lib/panes.js";
import { clock, day, IST, localDate } from "../lib/time.js";

export const WEEKDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];

function grid(state, ctx) {
  const edit = can(ctx.role, "admin-availability.save_rules");
  return html`<div class="week">${WEEKDAYS.map(([wd, name]) => {
    const rules = state.draft.map((r, i) => ({ ...r, i })).filter((r) => r.weekday === wd);
    return html`<div class="week-row">
      <span class="label">${name}</span>
      <div class="windows">
        ${rules.length ? rules.map((r) => html`<span class="window">
          <input type="time" step="900" aria-label="${name} start" data-input="rule" data-i="${r.i}" data-k="start_time" value="${r.start_time}"${edit ? "" : raw(" disabled")}>
          <span class="muted">–</span>
          <input type="time" step="900" aria-label="${name} end" data-input="rule" data-i="${r.i}" data-k="end_time" value="${r.end_time}"${edit ? "" : raw(" disabled")}>
          ${r.timezone !== IST ? html`<span class="pill">${r.timezone}</span>` : ""}
          <label class="muted"><input type="checkbox" data-change="rule" data-i="${r.i}" data-k="active"${r.active ? raw(" checked") : ""}${edit ? "" : raw(" disabled")}> on</label>
          ${edit ? html`<button class="link" type="button" data-click="remove-rule" data-i="${r.i}" aria-label="Remove ${name} ${r.start_time}–${r.end_time}">remove</button>` : ""}
        </span>`) : html`<span class="muted">Closed</span>`}
        ${edit ? html`<button class="btn small" type="button" data-click="add-rule" data-wd="${wd}">+ Window</button>` : ""}
      </div>
    </div>`;
  })}</div>`;
}

export function previewDays(state) {
  const tz = IST;
  const byDay = new Map();
  for (const s of state.preview.slots) {
    const d = localDate(s, tz);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const days = [];
  const start = Date.parse(state.preview.from);
  for (let i = 0; i < state.settings.windowDays; i++) {
    const iso = new Date(start + i * 86_400_000).toISOString();
    const d = localDate(iso, tz);
    days.push({ date: d, iso, slots: byDay.get(d) ?? [] });
  }
  return days;
}

function preview(state) {
  const days = previewDays(state);
  const total = state.preview.slots.length;
  return html`<p class="muted">${total} open hours in the next ${state.settings.windowDays} days · ${state.settings.minNoticeHours}h notice · ${state.settings.slotMinutes} min + ${state.settings.bufferMinutes} min buffer · times in IST</p>
    <div class="preview">${days.map((d) => html`<div class="day ${d.slots.length ? "" : "none"}">
      <span class="label ${d.slots.length ? "" : "muted"}">${day(d.iso)}</span>
      ${d.slots.length ? html`<div class="times">${d.slots.map((s) => html`<span class="t num" title="${clock(s, Intl.DateTimeFormat().resolvedOptions().timeZone)} your time">${clock(s)}</span>`)}</div>` : html`<span class="muted">No slots</span>`}
    </div>`)}</div>`;
}

function overrides(state, ctx) {
  const edit = can(ctx.role, "admin-availability.add_override");
  return html`
    ${edit ? html`<form class="filters" data-submit="add-override">
      <label class="field"><span class="label">Date</span><input type="date" name="date" required></label>
      <label class="field"><span class="label">Kind</span><select name="kind"><option value="block">Block</option><option value="extra">Open extra</option></select></label>
      <label class="field"><span class="label">From</span><input type="time" name="start_time" step="900"></label>
      <label class="field"><span class="label">To</span><input type="time" name="end_time" step="900"></label>
      <label class="field"><span class="label">Note</span><input type="text" name="note" maxlength="200" placeholder="Optional"></label>
      <button class="btn" type="submit">Add override</button>
    </form>
    <p class="muted">Block with no times blocks the whole day. Times are ${state.settings.timezone}.</p>` : ""}
    ${state.overrides.length ? html`<div class="table-wrap"><table class="stack"><thead><tr><th>Date</th><th>Kind</th><th>Hours</th><th>Note</th><th></th></tr></thead><tbody>
      ${state.overrides.map((o) => html`<tr>
        <td data-label="Date" class="num">${o.date}</td>
        <td data-label="Kind"><span class="pill ${o.kind === "block" ? "bad" : "ok"}">${o.kind === "block" ? "Blocked" : "Extra"}</span></td>
        <td data-label="Hours" class="num">${o.start_time ? `${String(o.start_time).slice(0, 5)}–${String(o.end_time).slice(0, 5)}` : "All day"}</td>
        <td data-label="Note">${o.note || ""}</td>
        <td class="actions">${can(ctx.role, "admin-availability.remove_override") ? html`<button class="btn small danger" type="button" data-click="remove-override" data-id="${o.id}">Remove</button>` : ""}</td>
      </tr>`)}
    </tbody></table></div>` : html`<p class="muted">No upcoming overrides.</p>`}`;
}

function fromServer(res) {
  return { ...res, draft: res.rules.map((r) => ({ ...r })), dirty: false };
}

export default {
  id: "availability",
  load: async (ctx) => fromServer(await ctx.api("admin-availability", { action: "get" })),
  regions: { savebar: (s) => savebar(s) },
  render(state, ctx) {
    return html`
      <section class="group"><h2>Weekly hours</h2>${grid(state, ctx)}
        ${can(ctx.role, "admin-availability.save_rules") ? html`<div class="pane-head" data-region="savebar">${savebar(state)}</div>` : ""}
      </section>
      <section class="group"><h2>Date overrides</h2>${overrides(state, ctx)}</section>
      <section class="group"><h2>What a visitor sees</h2>${preview(state)}</section>`;
  },
  on: {
    "input:rule"(el, pane) {
      const draft = pane.state.draft.map((r, i) => (i === Number(el.dataset.i) ? { ...r, [el.dataset.k]: el.value } : r));
      pane.patch({ draft, dirty: true }, "savebar");
    },
    "change:rule"(el, pane) {
      const draft = pane.state.draft.map((r, i) => (i === Number(el.dataset.i) ? { ...r, active: el.checked } : r));
      pane.patch({ draft, dirty: true }, "savebar");
    },
    "click:add-rule"(btn, pane) {
      const tz = pane.state.settings.timezone;
      pane.set({ draft: [...pane.state.draft, { weekday: Number(btn.dataset.wd), start_time: "10:00", end_time: "18:00", timezone: tz, active: true }], dirty: true });
    },
    "click:remove-rule"(btn, pane) {
      pane.set({ draft: pane.state.draft.filter((_, i) => i !== Number(btn.dataset.i)), dirty: true });
    },
    "click:revert"(_b, pane) {
      pane.set({ draft: pane.state.rules.map((r) => ({ ...r })), dirty: false });
    },
    async "click:save-rules"(_b, pane, ctx) {
      const res = await ctx.api("admin-availability", { action: "save_rules", rules: pane.state.draft });
      pane.set(fromServer(res));
      ctx.toast("Weekly hours saved. The preview below is live.");
    },
    async "submit:add-override"(form, pane, ctx) {
      const f = Object.fromEntries(new FormData(form));
      const res = await ctx.api("admin-availability", { action: "add_override", ...f });
      pane.set({ ...fromServer(res), draft: pane.state.dirty ? pane.state.draft : res.rules.map((r) => ({ ...r })), dirty: pane.state.dirty });
      ctx.toast("Override added.");
    },
    async "click:remove-override"(btn, pane, ctx) {
      if (!ctx.confirm("Remove this override?")) return;
      const res = await ctx.api("admin-availability", { action: "remove_override", override_id: btn.dataset.id });
      pane.set({ ...fromServer(res), draft: pane.state.dirty ? pane.state.draft : res.rules.map((r) => ({ ...r })), dirty: pane.state.dirty });
    },
  },
};

function savebar(state) {
  return html`<span class="muted">${state.dirty ? "Unsaved changes to weekly hours." : "Weekly hours saved."}</span>
    <span class="spacer"></span>
    ${state.dirty ? html`<button class="btn" type="button" data-click="revert">Revert</button>` : ""}
    <button class="btn primary" type="button" data-click="save-rules"${state.dirty ? "" : raw(" disabled")}>Save weekly hours</button>`;
}
