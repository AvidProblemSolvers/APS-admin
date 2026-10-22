// Availability pane: the weekly grid (availability_rules), one-off overrides
// (slot_overrides), and a preview of the next N days exactly as a visitor would see them.

import { audit } from "../_shared/audit.ts";
import { HttpError, notFound } from "../_shared/errors.ts";
import { str, uuid } from "../_shared/http.ts";
import { generateSlots, localDate, schedulerSettings } from "../_shared/slots.ts";
import type { Ctx, FunctionSpec, Row } from "../_shared/types.ts";

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:00)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function hhmm(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (!TIME.test(s)) throw new HttpError(400, "invalid_input", `${s} is not a time (HH:MM)`);
  return s.slice(0, 5);
}

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function snapshot(ctx: Ctx) {
  const { db, now } = ctx.deps;
  const at = now();
  const settingsRows = await db.select("site_settings", { columns: ["key", "value"], where: [["ilike", "key", "scheduler_%"]] });
  const s = schedulerSettings(Object.fromEntries(settingsRows.map((r) => [String(r.key), String(r.value ?? "")])));
  const today = localDate(at.getTime(), s.timezone);
  const [rules, overrides, booked] = await Promise.all([
    db.select("availability_rules", { order: [["weekday", "asc"], ["start_time", "asc"]] }),
    db.select("slot_overrides", { where: [["gte", "date", today]], order: [["date", "asc"], ["start_time", "asc"]] }),
    db.selectAll("bookings", { columns: ["slot_start", "slot_end", "status"], where: [["gte", "slot_start", at.toISOString()]] }),
  ]);
  const slots = generateSlots({ rules, overrides, booked, settings: s, now: at });
  return {
    rules: rules.map((r) => ({ ...r, start_time: String(r.start_time).slice(0, 5), end_time: String(r.end_time).slice(0, 5) })),
    overrides,
    settings: s,
    preview: { from: at.toISOString(), slots, booked: booked.filter((b) => b.status !== "cancelled").map((b) => b.slot_start) },
  };
}

function cleanRule(r: Row, defaultTz: string): Row {
  const weekday = Number(r.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, "invalid_input", "weekday must be 0–6");
  const start = hhmm(r.start_time);
  const end = hhmm(r.end_time);
  if (!start || !end) throw new HttpError(400, "invalid_input", "start and end are required");
  if (start >= end) throw new HttpError(400, "invalid_input", `${start}–${end}: end must be after start`);
  const timezone = r.timezone ? String(r.timezone) : defaultTz;
  if (!validTz(timezone)) throw new HttpError(400, "invalid_input", `${timezone} is not a timezone`);
  return { weekday, start_time: start, end_time: end, timezone, active: r.active !== false };
}

function overlaps(rules: Row[]) {
  const active = rules.filter((r) => r.active);
  for (const a of active) {
    for (const b of active) {
      if (a !== b && a.weekday === b.weekday && a.timezone === b.timezone &&
        String(a.start_time) < String(b.end_time) && String(b.start_time) < String(a.end_time)) {
        throw new HttpError(400, "invalid_input", "Two windows on the same day overlap.");
      }
    }
  }
}

async function saveRules(ctx: Ctx) {
  const { db } = ctx.deps;
  if (!Array.isArray(ctx.body.rules) || ctx.body.rules.length > 50) throw new HttpError(400, "invalid_input", "rules must be a list");
  const incoming = (ctx.body.rules as Row[]).map((r) => ({ id: r.id ? String(r.id) : null, ...cleanRule(r, "Asia/Kolkata") }));
  overlaps(incoming);
  const before = await db.select("availability_rules", { order: [["weekday", "asc"], ["start_time", "asc"]] });
  const beforeIds = new Set(before.map((r) => String(r.id)));
  const keep = new Set(incoming.filter((r) => r.id).map((r) => String(r.id)));
  for (const id of keep) if (!beforeIds.has(id)) throw new HttpError(400, "invalid_input", "unknown rule id");

  for (const r of before) {
    if (!keep.has(String(r.id))) await db.delete("availability_rules", [["eq", "id", r.id]]);
  }
  for (const { id, ...r } of incoming) {
    if (id) await db.update("availability_rules", [["eq", "id", id]], r);
    else await db.insert("availability_rules", r);
  }
  const summary = (rows: Row[]) =>
    rows.filter((r) => r.active !== false)
      .map((r) => `${r.weekday} ${String(r.start_time).slice(0, 5)}-${String(r.end_time).slice(0, 5)} ${r.timezone}`)
      .sort();
  await audit(ctx, { action: "availability.rules", target: "weekly", old_value: summary(before), new_value: summary(incoming) });
  return await snapshot(ctx);
}

async function addOverride(ctx: Ctx) {
  const date = str(ctx.body, "date", { required: true });
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, "invalid_input", "date must be YYYY-MM-DD");
  const kind = ctx.body.kind;
  if (kind !== "block" && kind !== "extra") throw new HttpError(400, "invalid_input", "kind must be block or extra");
  const start = hhmm(ctx.body.start_time);
  const end = hhmm(ctx.body.end_time);
  if ((start === null) !== (end === null)) throw new HttpError(400, "invalid_input", "give both times or neither");
  if (kind === "extra" && !start) throw new HttpError(400, "invalid_input", "an extra window needs times");
  if (start && end && start >= end) throw new HttpError(400, "invalid_input", "end must be after start");
  const note = str(ctx.body, "note", { max: 200 }) || null;
  const row = { date, kind, start_time: start, end_time: end, note };
  const [saved] = await ctx.deps.db.insert("slot_overrides", row);
  await audit(ctx, { action: `availability.override_${kind}`, target: date, new_value: row });
  return { ...(await snapshot(ctx)), saved };
}

async function removeOverride(ctx: Ctx) {
  const id = uuid(ctx.body, "override_id");
  const [gone] = await ctx.deps.db.delete("slot_overrides", [["eq", "id", id]]);
  if (!gone) throw notFound();
  await audit(ctx, { action: "availability.override_remove", target: String(gone.date), old_value: gone });
  return await snapshot(ctx);
}

export const spec: FunctionSpec = {
  name: "admin-availability",
  actions: {
    get: { roles: ["owner", "admin"], run: snapshot },
    save_rules: { roles: ["owner", "admin"], run: saveRules },
    add_override: { roles: ["owner", "admin"], run: addOverride },
    remove_override: { roles: ["owner", "admin"], run: removeOverride },
  },
};
