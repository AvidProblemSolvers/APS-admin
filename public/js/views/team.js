// 8. Team — owner only. Invite by magic link, change role, deactivate (never delete).

import { html, raw } from "../lib/html.js";
import { can } from "../lib/panes.js";
import { dateTime } from "../lib/time.js";

const ROLES = ["owner", "admin", "team"];

export default {
  id: "team",
  load: (ctx) => ctx.api("admin-team", { action: "list" }),
  render(state, ctx) {
    const activeOwners = state.rows.filter((m) => m.role === "owner" && m.active).length;
    return html`
      ${can(ctx.role, "admin-team.invite") ? html`<form class="card filters" data-submit="invite">
        <label class="field"><span class="label">Email</span><input type="email" name="email" required maxlength="254" autocomplete="off"></label>
        <label class="field"><span class="label">Name</span><input type="text" name="full_name" maxlength="120"></label>
        <label class="field"><span class="label">Role</span><select name="role">${ROLES.map((r) => html`<option${r === "team" ? raw(" selected") : ""}>${r}</option>`)}</select></label>
        <button class="btn primary" type="submit">Send invite</button>
        <span class="muted">They get a magic link. There is no sign-up anywhere else.</span>
      </form>` : ""}
      <div class="table-wrap"><table class="stack">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>State</th><th>Added</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${state.rows.map((m) => {
          const self = m.id === state.self;
          const lastOwner = m.role === "owner" && m.active && activeOwners <= 1;
          const locked = self || lastOwner;
          return html`<tr>
            <td data-label="Name">${m.full_name || html`<span class="muted">—</span>`}${self ? html` <span class="pill">You</span>` : ""}</td>
            <td data-label="Email">${m.email}</td>
            <td data-label="Role">${!locked && can(ctx.role, "admin-team.set_role")
              ? html`<select aria-label="Role for ${m.email}" data-change="role" data-id="${m.id}">${ROLES.map((r) => html`<option${r === m.role ? raw(" selected") : ""}>${r}</option>`)}</select>`
              : html`<span class="pill">${m.role}</span>${lastOwner ? html` <span class="muted">last owner</span>` : ""}`}</td>
            <td data-label="State">${m.active ? html`<span class="pill ok">Active</span>` : html`<span class="pill bad">Deactivated</span>`}</td>
            <td data-label="Added" class="num">${dateTime(m.created_at)}</td>
            <td class="actions">${locked ? "" : html`
              ${m.active && can(ctx.role, "admin-team.resend_link") ? html`<button class="btn small" type="button" data-click="resend" data-id="${m.id}">Resend link</button> ` : ""}
              ${can(ctx.role, "admin-team.set_active") ? html`<button class="btn small ${m.active ? "danger" : ""}" type="button" data-click="active" data-id="${m.id}" data-active="${m.active ? "false" : "true"}">${m.active ? "Deactivate" : "Reactivate"}</button>` : ""}`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      <p class="muted">Members are deactivated, never deleted, so the audit history always resolves to a person.</p>`;
  },
  on: {
    async "submit:invite"(form, pane, ctx) {
      const f = Object.fromEntries(new FormData(form));
      await ctx.api("admin-team", { action: "invite", ...f });
      ctx.toast(`Invite sent to ${f.email}.`);
      await pane.reload();
    },
    async "change:role"(sel, pane, ctx) {
      const m = pane.state.rows.find((x) => x.id === sel.dataset.id);
      if (!ctx.confirm(`Change ${m.email} from ${m.role} to ${sel.value}?`)) {
        sel.value = m.role;
        return;
      }
      try {
        await ctx.api("admin-team", { action: "set_role", member_id: m.id, role: sel.value });
        ctx.toast("Role changed.");
      } finally {
        await pane.reload();
      }
    },
    async "click:active"(btn, pane, ctx) {
      const m = pane.state.rows.find((x) => x.id === btn.dataset.id);
      const active = btn.dataset.active === "true";
      if (!ctx.confirm(`${active ? "Reactivate" : "Deactivate"} ${m.email}?${active ? "" : " They lose access immediately."}`)) return;
      await ctx.api("admin-team", { action: "set_active", member_id: m.id, active });
      await pane.reload();
    },
    async "click:resend"(btn, _pane, ctx) {
      await ctx.api("admin-team", { action: "resend_link", member_id: btn.dataset.id });
      ctx.toast("Sign-in link sent.");
    },
  },
};
