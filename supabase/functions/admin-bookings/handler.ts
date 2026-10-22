// Bookings pane. Revenue (bookings.amount, bookings.currency, the monthly total) is
// selected ONLY for the owner. For admin and team the columns are never requested from
// the database, so they cannot appear in a response.

import { audit } from "../_shared/audit.ts";
import { HttpError, notFound } from "../_shared/errors.ts";
import { confirmedUrl, fmtBoth, IST, monthStartIst } from "../_shared/format.ts";
import { csv, uuid } from "../_shared/http.ts";
import type { Ctx, FunctionSpec, Row } from "../_shared/types.ts";

const BASE_COLUMNS = [
  "id", "created_at", "payer_name", "payer_email", "status", "heard_from", "slot_start", "slot_end",
  "scheduled", "brief_submitted_at", "reminder_sent_at", "meet_link", "razorpay_payment_id",
];
const REVENUE_COLUMNS = ["amount", "currency"];
const DAY = 86_400_000;

function columnsFor(ctx: Ctx): string[] {
  return ctx.actor.role === "owner" ? [...BASE_COLUMNS, ...REVENUE_COLUMNS] : BASE_COLUMNS;
}

export function isFlagged(b: Row, now: Date): boolean {
  return b.status === "captured" && b.scheduled !== true &&
    now.getTime() - Date.parse(String(b.created_at)) > DAY;
}

async function list(ctx: Ctx) {
  const { db, now } = ctx.deps;
  const at = now();
  const rows = await db.selectAll("bookings", { columns: columnsFor(ctx), order: [["created_at", "desc"]] });

  // The client's own timezone is only known when they asked for alternate times.
  // slot_requests is small; reading it whole avoids an unbounded IN list in the URL.
  const reqs = await db.selectAll("slot_requests", {
    columns: ["booking_id", "requester_timezone", "status", "created_at"],
    order: [["created_at", "desc"]],
  });
  const tzByBooking = new Map<unknown, unknown>();
  const pendingByBooking = new Set<unknown>();
  for (const r of reqs) {
    if (!tzByBooking.has(r.booking_id) && r.requester_timezone) tzByBooking.set(r.booking_id, r.requester_timezone);
    if (r.status === "pending") pendingByBooking.add(r.booking_id);
  }

  const out: Row[] = rows.map((b) => ({
    ...b,
    client_timezone: tzByBooking.get(b.id) ?? null,
    pending_request: pendingByBooking.has(b.id),
    flagged: isFlagged(b, at),
  }));
  // Flagged rows pinned to the top, oldest problem first; the rest newest first.
  out.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    const d = Date.parse(String(b.created_at)) - Date.parse(String(a.created_at));
    return a.flagged ? -d : d;
  });

  const live = rows.filter((b) => b.status !== "cancelled" && b.status !== "refunded");
  const stats: Row = {
    total: live.length,
    upcoming: live.filter((b) => b.scheduled === true && b.slot_start && Date.parse(String(b.slot_start)) > at.getTime()).length,
    paid_not_scheduled: live.filter((b) => b.status === "captured" && b.scheduled !== true).length,
    brief_missing: live.filter((b) => b.status === "captured" && !b.brief_submitted_at).length,
  };
  if (ctx.actor.role === "owner") {
    const since = monthStartIst(at).getTime();
    const month = rows.filter((b) => b.status === "captured" && Date.parse(String(b.created_at)) >= since);
    const byCurrency: Record<string, number> = {};
    for (const b of month) {
      const c = String(b.currency || "USD");
      byCurrency[c] = Math.round(((byCurrency[c] ?? 0) + Number(b.amount || 0)) * 100) / 100;
    }
    stats.revenue_month = byCurrency;
  }
  return { rows: out, stats, now: at.toISOString() };
}

async function detail(ctx: Ctx) {
  const id = uuid(ctx.body, "booking_id");
  const { db, storage, env } = ctx.deps;
  const [b] = await db.select("bookings", { columns: ["id", "session_id"], where: [["eq", "id", id]], limit: 1 });
  if (!b) throw notFound();
  const [brief] = await db.select("project_briefs", {
    columns: ["problem", "already_tried", "how_measured", "what_fixed_looks_like", "who_involved", "file_urls", "submitted_at", "updated_at"],
    where: [["eq", "booking_id", id]],
    limit: 1,
  });
  const probes = b.session_id
    ? await db.select("probe_queries", {
      columns: ["problem_text", "business_text", "goal_text", "verdict", "created_at"],
      where: [["eq", "session_id", b.session_id]],
      order: [["created_at", "asc"]],
      limit: 20,
    })
    : [];
  let files: { name: string; url: string | null }[] = [];
  if (brief && Array.isArray(brief.file_urls)) {
    const bucket = env("BRIEF_BUCKET") ?? "briefs";
    files = await Promise.all((brief.file_urls as string[]).map(async (p) => ({
      name: p.split("/").pop() ?? p,
      url: /^https?:\/\//.test(p) ? p : await storage.signedUrl(bucket, p, 600).catch(() => null),
    })));
  }
  return { brief: brief ?? null, files, probes };
}

async function emailLink(ctx: Ctx) {
  const id = uuid(ctx.body, "booking_id");
  const { db, mailer, env, now } = ctx.deps;
  const [b] = await db.select("bookings", {
    columns: ["id", "payer_name", "payer_email", "status", "scheduled", "razorpay_payment_id", "reminder_sent_at"],
    where: [["eq", "id", id]],
    limit: 1,
  });
  if (!b) throw notFound();
  if (b.status !== "captured" || b.scheduled === true) throw new HttpError(409, "not_unscheduled");
  if (!b.payer_email) throw new HttpError(409, "no_email");
  const link = confirmedUrl(env("SITE_ORIGIN") ?? "https://avidproblemsolvers.com", String(b.razorpay_payment_id));
  const name = b.payer_name ? String(b.payer_name).split(" ")[0] : "there";
  await mailer.send({
    to: String(b.payer_email),
    subject: "Choose your hour",
    text: `Hi ${name},\n\nYour consultation is paid for, but no time is booked yet. ` +
      `Choose the hour that suits you here:\n\n${link}\n\n` +
      `If none of the times work, there is a link on that page to suggest three of your own.\n\n— Avid Problem Solvers`,
  });
  const sentAt = now().toISOString();
  // Setting reminder_sent_at stops the 6-hourly cron from sending a second copy.
  await db.update("bookings", [["eq", "id", id]], { reminder_sent_at: sentAt });
  await audit(ctx, { action: "booking.email_link", target: id, old_value: b.reminder_sent_at, new_value: sentAt });
  return { ok: true, reminder_sent_at: sentAt };
}

async function exportCsv(ctx: Ctx) {
  const rows = await ctx.deps.db.selectAll("bookings", {
    columns: [...BASE_COLUMNS, ...REVENUE_COLUMNS],
    order: [["created_at", "desc"]],
  });
  const withIst = rows.map((r) => ({ ...r, slot_ist: r.slot_start ? fmtBoth(String(r.slot_start), IST) : "" }));
  const cols = [
    "created_at", "payer_name", "payer_email", "amount", "currency", "status", "slot_start", "slot_ist",
    "scheduled", "heard_from", "brief_submitted_at", "razorpay_payment_id", "id",
  ];
  return csv(`aps-bookings-${ctx.deps.now().toISOString().slice(0, 10)}.csv`, cols, withIst);
}

export const spec: FunctionSpec = {
  name: "admin-bookings",
  actions: {
    list: { roles: ["owner", "admin", "team"], run: list },
    detail: { roles: ["owner", "admin", "team"], run: detail },
    email_link: { roles: ["owner", "admin"], run: emailLink },
    export_csv: { roles: ["owner"], run: exportCsv },
  },
};
