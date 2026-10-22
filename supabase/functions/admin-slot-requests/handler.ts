// Slot requests pane: alternate-time requests from clients for whom no listed slot worked.

import { audit } from "../_shared/audit.ts";
import { HttpError, notFound } from "../_shared/errors.ts";
import { confirmedUrl, fmtBoth, IST } from "../_shared/format.ts";
import { str, uuid } from "../_shared/http.ts";
import { generateSlots, schedulerSettings } from "../_shared/slots.ts";
import type { Ctx, FunctionSpec, Row } from "../_shared/types.ts";

const BOOKING_COLUMNS = ["id", "payer_name", "payer_email", "status", "scheduled", "slot_start", "razorpay_payment_id", "brief_token", "created_at"];

async function settingsValues(ctx: Ctx): Promise<Record<string, string>> {
  const rows = await ctx.deps.db.select("site_settings", { columns: ["key", "value"], where: [["ilike", "key", "scheduler_%"]] });
  return Object.fromEntries(rows.map((r) => [String(r.key), String(r.value ?? "")]));
}

async function list(ctx: Ctx) {
  const status = ctx.body.status === "all" ? null : "pending";
  const reqs = await ctx.deps.db.select("slot_requests", {
    where: status ? [["eq", "status", status]] : [],
    order: [["created_at", "desc"]],
    limit: 200,
  });
  const ids = [...new Set(reqs.map((r) => r.booking_id).filter(Boolean))];
  const bookings = ids.length
    ? await ctx.deps.db.select("bookings", { columns: BOOKING_COLUMNS, where: [["in", "id", ids]] })
    : [];
  const byId = new Map(bookings.map((b) => [b.id, b]));
  return { rows: reqs.map((r) => ({ ...r, booking: byId.get(r.booking_id) ?? null })) };
}

async function claimPending(ctx: Ctx, id: string, status: "approved" | "declined", note: string | null): Promise<Row> {
  const patch: Row = { status };
  if (note) patch.note = note;
  const [req] = await ctx.deps.db.update("slot_requests", [["eq", "id", id], ["eq", "status", "pending"]], patch);
  if (!req) {
    const [exists] = await ctx.deps.db.select("slot_requests", { columns: ["id"], where: [["eq", "id", id]], limit: 1 });
    throw exists ? new HttpError(409, "already_decided") : notFound();
  }
  return req;
}

async function approve(ctx: Ctx) {
  const id = uuid(ctx.body, "request_id");
  const choice = Number(ctx.body.choice);
  if (![1, 2, 3].includes(choice)) throw new HttpError(400, "invalid_input", "choice must be 1, 2 or 3");
  const { db, meetings, mailer, env, now } = ctx.deps;

  const [pre] = await db.select("slot_requests", { where: [["eq", "id", id]], limit: 1 });
  if (!pre) throw notFound();
  const slot = pre[`preferred_${choice}`];
  if (!slot) throw new HttpError(400, "invalid_input", "that preferred time is empty");
  if (Date.parse(String(slot)) <= now().getTime()) throw new HttpError(409, "slot_in_past");

  const [b] = await db.select("bookings", { columns: BOOKING_COLUMNS, where: [["eq", "id", pre.booking_id]], limit: 1 });
  if (!b) throw notFound("booking_not_found");
  if (b.status !== "captured") throw new HttpError(409, "booking_not_paid");
  if (b.scheduled === true) throw new HttpError(409, "already_scheduled");

  const req = await claimPending(ctx, id, "approved", null);
  const s = schedulerSettings(await settingsValues(ctx));
  const start = new Date(String(slot)).toISOString();
  const end = new Date(Date.parse(start) + s.slotMinutes * 60_000).toISOString();
  try {
    // The partial unique index on bookings.slot_start makes a double-booking fail here.
    await db.update("bookings", [["eq", "id", b.id], ["eq", "scheduled", false]], {
      slot_start: start, slot_end: end, scheduled: true,
    });
  } catch (e) {
    await db.update("slot_requests", [["eq", "id", id]], { status: "pending" });
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "slot_taken");
    throw e;
  }

  const warnings: string[] = [];
  let meetLink: string | null = null;
  try {
    meetLink = (await meetings.create(String(b.id))).meet_link;
  } catch {
    warnings.push("The booking is set but the calendar invite and Meet link failed. Retry from Google Calendar.");
  }

  const tz = (req.requester_timezone as string) || null;
  const when = fmtBoth(start, tz);
  const site = (env("SITE_ORIGIN") ?? "https://avidproblemsolvers.com").replace(/\/$/, "");
  const admin = (env("ADMIN_ORIGIN") ?? "https://admin.avidproblemsolvers.com").split(",")[0];
  const mails = [
    {
      to: String(b.payer_email),
      subject: "You're booked",
      text: `Your consultation is confirmed for ${when}.\n\n` +
        (meetLink ? `Google Meet: ${meetLink}\n\n` : "") +
        `A calendar invite follows separately. Before we speak, please fill in the project brief so I arrive ` +
        `prepared:\n\n${site}/brief/${b.brief_token}\n\n— Avid Problem Solvers`,
    },
    {
      to: env("OWNER_EMAIL") ?? ctx.actor.email,
      subject: `Booked: ${b.payer_name ?? b.payer_email} — ${fmtBoth(start, IST)}`,
      text: `Alternate-time request approved by ${ctx.actor.email}.\n\nClient: ${b.payer_name ?? ""} <${b.payer_email}>\n` +
        `When: ${when}\nMeet: ${meetLink ?? "(not created)"}\nAdmin: ${admin}`,
    },
  ];
  for (const m of mails) {
    if (!m.to || m.to === "null") continue;
    await mailer.send(m).catch(() => warnings.push(`Email to ${m.to} failed.`));
  }

  await audit(ctx, {
    action: "slot_request.approve",
    target: id,
    old_value: { status: "pending", booking: b.id },
    new_value: { status: "approved", slot_start: start, choice },
  });
  return { ok: true, slot_start: start, meet_link: meetLink, warnings };
}

async function decline(ctx: Ctx) {
  const id = uuid(ctx.body, "request_id");
  const note = str(ctx.body, "note", { max: 1000 }) || null;
  const { db, mailer, env, now } = ctx.deps;
  const [pre] = await db.select("slot_requests", { where: [["eq", "id", id]], limit: 1 });
  if (!pre) throw notFound();
  const [b] = await db.select("bookings", { columns: BOOKING_COLUMNS, where: [["eq", "id", pre.booking_id]], limit: 1 });
  const req = await claimPending(ctx, id, "declined", note);

  // "Emails them the standard slot list": the same slots /confirmed would offer right now.
  const s = schedulerSettings(await settingsValues(ctx));
  const [rules, overrides, booked] = await Promise.all([
    db.select("availability_rules", { where: [["eq", "active", true]] }),
    db.select("slot_overrides", {}),
    db.selectAll("bookings", { columns: ["slot_start", "slot_end", "status"], where: [["gte", "slot_start", now().toISOString()]] }),
  ]);
  const slots = generateSlots({ rules, overrides, booked, settings: s, now: now() }).slice(0, 12);
  const tz = (req.requester_timezone as string) || null;
  const link = b ? confirmedUrl(env("SITE_ORIGIN") ?? "https://avidproblemsolvers.com", String(b.razorpay_payment_id)) : "";

  const warnings: string[] = [];
  if (b?.payer_email) {
    await mailer.send({
      to: String(b.payer_email),
      subject: "About the times you suggested",
      text: `Thank you for suggesting times. Unfortunately none of them can be held.\n\n` +
        (note ? `${note}\n\n` : "") +
        (slots.length ? `These are the next open hours:\n\n${slots.map((x) => `  • ${fmtBoth(x, tz)}`).join("\n")}\n\n` : "") +
        `Choose one here: ${link}\n\n— Avid Problem Solvers`,
    }).catch(() => warnings.push("Email to the client failed."));
  }
  await audit(ctx, {
    action: "slot_request.decline",
    target: id,
    old_value: { status: "pending" },
    new_value: { status: "declined", note },
  });
  return { ok: true, offered: slots.length, warnings };
}

export const spec: FunctionSpec = {
  name: "admin-slot-requests",
  actions: {
    list: { roles: ["owner", "admin"], run: list },
    approve: { roles: ["owner", "admin"], run: approve },
    decline: { roles: ["owner", "admin"], run: decline },
  },
};
