// In-memory stand-in for PostgREST, used by the tests and the local mock server. It knows
// the column list of every table from SPEC §5 (plus site_settings), rejects unknown
// columns the way Postgres would, enforces the unique constraints the admin relies on, and
// emulates the site_settings audit trigger. Always wrapped in guardDb() like production.

import { DbError } from "../supabase/functions/_shared/errors.ts";
import type { Db, Row, SelectOpts, Where } from "../supabase/functions/_shared/types.ts";

export const SCHEMA: Record<string, string[]> = {
  // sort_order is nullable and may not exist yet: the admin never names it in a query.
  site_content: ["key", "value", "updated_at", "sort_order"],
  site_settings: ["key", "value", "updated_at", "updated_by"],
  answers: ["id", "slug", "title", "summary", "body_md", "question", "related", "published", "created_at", "updated_at"],
  bookings: [
    "id", "razorpay_payment_id", "razorpay_order_id", "amount", "currency", "status", "payer_name", "payer_email",
    "heard_from", "session_id", "slot_start", "slot_end", "meet_link", "calendar_event_id", "brief_token",
    "brief_submitted_at", "scheduled", "reminder_sent_at", "brief_nudge_sent_at", "created_at",
  ],
  availability_rules: ["id", "weekday", "start_time", "end_time", "timezone", "active"],
  slot_overrides: ["id", "date", "kind", "start_time", "end_time", "note"],
  slot_requests: [
    "id", "booking_id", "preferred_1", "preferred_2", "preferred_3", "requester_timezone", "status", "note", "created_at",
  ],
  project_briefs: [
    "id", "booking_id", "problem", "already_tried", "how_measured", "what_fixed_looks_like", "who_involved",
    "file_urls", "submitted_at", "updated_at",
  ],
  probe_queries: [
    "id", "problem_text", "verdict", "business_text", "goal_text", "session_id", "country", "referrer", "converted",
    "created_at",
  ],
  page_views: [
    "id", "country", "region", "city", "referrer", "utm_source", "utm_medium", "utm_campaign", "path", "device",
    "session_id", "created_at",
  ],
  webhook_events: ["id", "event_id", "source", "event_type", "payload", "processed_at"],
  team_members: ["id", "email", "full_name", "role", "active", "invited_by", "created_at"],
  audit_log: ["id", "actor_id", "actor_email", "action", "target", "old_value", "new_value", "actor_country", "created_at"],
};

const PK: Record<string, string> = { site_content: "key", site_settings: "key" };

const UNIQUE: Record<string, string[]> = {
  bookings: ["razorpay_payment_id", "brief_token"],
  answers: ["slug"],
  team_members: ["email"],
  project_briefs: ["booking_id"],
  webhook_events: ["event_id"],
};

const DEFAULTS: Record<string, Row> = {
  bookings: { currency: "USD", scheduled: false },
  availability_rules: { timezone: "Asia/Kolkata", active: true },
  slot_requests: { status: "pending" },
  answers: { published: false },
  probe_queries: { converted: false },
  team_members: { active: true },
};

const CHECKS: Record<string, (r: Row) => boolean> = {
  team_members: (r) => ["owner", "admin", "team"].includes(String(r.role)),
  slot_overrides: (r) => ["block", "extra"].includes(String(r.kind)),
  slot_requests: (r) => ["pending", "approved", "declined"].includes(String(r.status)),
  availability_rules: (r) => Number(r.weekday) >= 0 && Number(r.weekday) <= 6,
};

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

function norm(v: unknown): unknown {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).getTime();
  return v;
}

function matches(row: Row, where: Where = []): boolean {
  return where.every(([op, col, val]) => {
    const a = norm(row[col]);
    const b = norm(val);
    switch (op) {
      case "eq": return String(a) === String(b);
      case "neq": return a !== null && a !== undefined && String(a) !== String(b);
      case "gt": return a !== null && a !== undefined && (a as number) > (b as number);
      case "gte": return a !== null && a !== undefined && (a as number) >= (b as number);
      case "lt": return a !== null && a !== undefined && (a as number) < (b as number);
      case "lte": return a !== null && a !== undefined && (a as number) <= (b as number);
      case "is": return val === null ? a === null || a === undefined : a === val;
      case "in": return (val as unknown[]).map(String).includes(String(a));
      case "ilike": {
        const re = new RegExp(
          "^" + String(val).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*") + "$", "is",
        );
        return typeof row[col] === "string" && re.test(row[col] as string);
      }
    }
  });
}

export class MemoryDb implements Db {
  tables: Record<string, Row[]> = {};
  now: () => Date;
  /** Every mutation, for assertions. */
  log: { verb: string; table: string }[] = [];

  constructor(seed: Record<string, Row[]> = {}, now: () => Date = () => new Date()) {
    this.now = now;
    for (const t of Object.keys(SCHEMA)) this.tables[t] = [];
    for (const [t, rows] of Object.entries(seed)) for (const r of rows) this.raw(t, r);
  }

  private table(t: string): Row[] {
    if (!SCHEMA[t]) throw new DbError("42P01", `relation "${t}" does not exist`, 404);
    return this.tables[t];
  }

  private checkCols(t: string, cols: string[]) {
    for (const c of cols) {
      if (!SCHEMA[t].includes(c)) throw new DbError("42703", `column ${t}.${c} does not exist`, 400);
    }
  }

  /** Inserts without triggers; used for seeding. */
  raw(t: string, r: Row): Row {
    const row: Row = { ...DEFAULTS[t] };
    if (SCHEMA[t].includes("id") && !r.id) row.id = crypto.randomUUID();
    if (SCHEMA[t].includes("created_at")) row.created_at = this.now().toISOString();
    Object.assign(row, r);
    this.table(t).push(row);
    return row;
  }

  private checkUnique(t: string, row: Row, self?: Row) {
    const others = this.table(t).filter((r) => r !== self);
    const keys = [...(UNIQUE[t] ?? []), PK[t] ?? "id"].filter((k) => SCHEMA[t].includes(k));
    for (const k of keys) {
      if (row[k] === null || row[k] === undefined) continue;
      if (others.some((o) => o[k] === row[k])) throw new DbError("23505", `duplicate key ${t}.${k}`, 409);
    }
    // Partial unique index from §6.3: one non-cancelled booking per slot_start.
    if (t === "bookings" && row.slot_start && row.status !== "cancelled") {
      const at = norm(row.slot_start);
      if (others.some((o) => o.status !== "cancelled" && o.slot_start && norm(o.slot_start) === at)) {
        throw new DbError("23505", "duplicate key bookings.slot_start", 409);
      }
    }
    if (CHECKS[t] && !CHECKS[t](row)) throw new DbError("23514", `check constraint on ${t}`, 400);
  }

  async select(t: string, o: SelectOpts = {}): Promise<Row[]> {
    let rows = this.table(t).filter((r) => matches(r, o.where));
    this.checkCols(t, [...(o.columns ?? []), ...(o.where ?? []).map((w) => w[1]), ...(o.order ?? []).map((x) => x[0])]);
    for (const [col, dir] of [...(o.order ?? [])].reverse()) {
      rows = [...rows].sort((a, b) => cmp(norm(a[col]), norm(b[col])) * (dir === "desc" ? -1 : 1));
    }
    const start = o.offset ?? 0;
    rows = rows.slice(start, o.limit === undefined ? undefined : start + o.limit);
    return rows.map((r) => {
      const cols = o.columns ?? SCHEMA[t];
      return Object.fromEntries(cols.map((c) => [c, structuredClone(r[c] ?? null)]));
    });
  }

  selectAll(t: string, o: SelectOpts = {}) {
    return this.select(t, { ...o, limit: undefined, offset: undefined });
  }

  async count(t: string, where: Where = []) {
    return (await this.select(t, { where })).length;
  }

  async insert(t: string, rows: Row | Row[]): Promise<Row[]> {
    const list = Array.isArray(rows) ? rows : [rows];
    const out: Row[] = [];
    for (const r of list) {
      this.checkCols(t, Object.keys(r));
      const row: Row = { ...DEFAULTS[t] };
      if (SCHEMA[t].includes("id") && !r.id) row.id = crypto.randomUUID();
      if (SCHEMA[t].includes("created_at")) row.created_at = this.now().toISOString();
      Object.assign(row, structuredClone(r));
      this.checkUnique(t, row);
      this.table(t).push(row);
      this.log.push({ verb: "insert", table: t });
      if (t === "site_settings") this.settingsTrigger(null, row);
      out.push({ ...row });
    }
    return out;
  }

  async update(t: string, where: Where, patch: Row): Promise<Row[]> {
    this.checkCols(t, Object.keys(patch));
    const out: Row[] = [];
    for (const row of this.table(t).filter((r) => matches(r, where))) {
      const before = { ...row };
      const next = { ...row, ...structuredClone(patch) };
      this.checkUnique(t, next, row);
      Object.assign(row, next);
      this.log.push({ verb: "update", table: t });
      if (t === "site_settings") this.settingsTrigger(before, row);
      out.push({ ...row });
    }
    return out;
  }

  async delete(t: string, where: Where): Promise<Row[]> {
    const keep: Row[] = [];
    const gone: Row[] = [];
    for (const r of this.table(t)) (matches(r, where) ? gone : keep).push(r);
    this.tables[t] = keep;
    if (gone.length) this.log.push({ verb: "delete", table: t });
    return gone;
  }

  /** Emulates the site repo's trigger on site_settings: one audit row per write. */
  private settingsTrigger(before: Row | null, after: Row) {
    const who = this.tables.team_members.find((m) => m.id === after.updated_by);
    this.tables.audit_log.push({
      id: crypto.randomUUID(),
      actor_id: after.updated_by ?? null,
      actor_email: who ? who.email : "system",
      action: "site_settings.update",
      target: after.key,
      old_value: before ? before.value : null,
      new_value: after.value,
      actor_country: null,
      created_at: this.now().toISOString(),
    });
  }
}
