// 2. Slot requests — owner, admin. Pending alternate-time requests, three preferred times
// shown in the client's timezone and IST.

import { html } from "../lib/html.js";
import { can } from "../lib/panes.js";
import { dateTime, dateTimeLong, IST, sameAsIst, tzAbbr } from "../lib/time.js";

function when(iso, tz) {
  const theirs = tz && !sameAsIst(iso, tz) ? html`<span class="num">${dateTimeLong(iso, tz)} ${tzAbbr(iso, tz)}</span><span class="sub num">${dateTimeLong(iso, IST)} IST</span>` : html`<span class="num">${dateTimeLong(iso, IST)} IST</span>`;
  return theirs;
}

function request(r, ctx, now) {
  const b = r.booking || {};
  const approver = can(ctx.role, "admin-slot-requests.approve");
  return html`<article class="card">
    <div class="card-head">
      <h2>${b.payer_name || b.payer_email || "Unknown booking"}</h2>
      ${b.payer_email ? html`<a href="mailto:${b.payer_email}">${b.payer_email}</a>` : ""}
      <span class="muted">Asked ${dateTime(r.created_at)} IST · their zone ${r.requester_timezone || "unknown"}</span>
      ${r.status !== "pending" ? html`<span class="pill ${r.status === "approved" ? "ok" : "bad"}">${r.status}</span>` : ""}
    </div>
    ${r.note ? html`<p class="muted">“${r.note}”</p>` : ""}
    <div class="table-wrap"><table class="stack"><tbody>
      ${[1, 2, 3].map((n) => {
        const iso = r[`preferred_${n}`];
        if (!iso) return "";
        const past = Date.parse(iso) <= now;
        return html`<tr>
          <td data-label="Choice ${n}">${when(iso, r.requester_timezone)}</td>
          <td class="actions">${past ? html`<span class="pill">In the past</span>` : approver && r.status === "pending"
            ? html`<button class="btn small primary" type="button" data-click="approve" data-id="${r.id}" data-choice="${n}">Approve this time</button>` : ""}</td>
        </tr>`;
      })}
    </tbody></table></div>
    ${approver && r.status === "pending" ? html`<form class="filters" data-submit="decline" data-id="${r.id}">
      <label class="field"><span class="label">Note to client (optional)</span><input type="text" name="note" maxlength="1000" placeholder="Sent with the standard slot list"></label>
      <button class="btn danger" type="submit">Decline and send slot list</button>
    </form>` : ""}
  </article>`;
}

export default {
  id: "slot-requests",
  initial: () => ({ show: "pending" }),
  load: (ctx, state) => ctx.api("admin-slot-requests", { action: "list", status: state?.show ?? "pending" }),
  render(state, ctx) {
    const now = Date.now();
    return html`
      <div class="pane-head">
        <h1>Alternate-time requests</h1>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Show">
          <button type="button" data-click="show" data-show="pending" aria-pressed="${state.show === "pending"}">PENDING</button>
          <button type="button" data-click="show" data-show="all" aria-pressed="${state.show === "all"}">ALL</button>
        </div>
      </div>
      ${state.rows.length ? state.rows.map((r) => request(r, ctx, now)) : html`<p class="empty">No ${state.show === "pending" ? "pending " : ""}requests.</p>`}`;
  },
  on: {
    async "click:show"(btn, pane) {
      pane.set({ show: btn.dataset.show });
      await pane.reload();
    },
    async "click:approve"(btn, pane, ctx) {
      const r = pane.state.rows.find((x) => x.id === btn.dataset.id);
      const iso = r[`preferred_${btn.dataset.choice}`];
      if (!ctx.confirm(`Book ${r.booking?.payer_name || "this client"} for ${dateTimeLong(iso, IST)} IST? This creates the Meet invite and emails both of you.`)) return;
      const res = await ctx.api("admin-slot-requests", { action: "approve", request_id: r.id, choice: Number(btn.dataset.choice) });
      ctx.toast(res.warnings?.length ? res.warnings.join(" ") : "Approved. Invite and emails sent.", Boolean(res.warnings?.length));
      await pane.reload();
    },
    async "submit:decline"(form, pane, ctx) {
      if (!ctx.confirm("Decline these times and email the client the standard slot list?")) return;
      const res = await ctx.api("admin-slot-requests", { action: "decline", request_id: form.dataset.id, note: form.elements.note.value });
      ctx.toast(res.warnings?.length ? res.warnings.join(" ") : `Declined. Sent ${res.offered} open slots.`, Boolean(res.warnings?.length));
      await pane.reload();
    },
  },
};
