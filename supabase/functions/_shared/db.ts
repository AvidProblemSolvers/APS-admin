// Data layer. Every Db the functions see — production PostgREST or the in-memory mock —
// is wrapped in guardDb(), which makes the audit log append-only at the code level as
// well as by RLS, and allows hard deletes only on the two scheduling tables.

import { DbError } from "./errors.ts";
import type { Db, Row, SelectOpts, Where } from "./types.ts";

/** Tables with no UPDATE and no DELETE path, for anyone. */
export const APPEND_ONLY = new Set(["audit_log"]);

/** The only tables any admin action may hard-delete from. Everything else is soft state. */
export const DELETABLE = new Set(["slot_overrides", "availability_rules"]);

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new DbError("42602", `invalid identifier: ${name}`);
  return name;
}

export class AppendOnlyError extends DbError {
  constructor(table: string, verb: string) {
    super("42501", `${table} is append-only: ${verb} is not permitted`, 403);
  }
}

export function guardDb(inner: Db): Db {
  return {
    select: (t, o) => inner.select(ident(t), o),
    selectAll: (t, o) => inner.selectAll(ident(t), o),
    count: (t, w) => inner.count(ident(t), w),
    insert: (t, rows) => inner.insert(ident(t), rows),
    update(t, where, patch) {
      if (APPEND_ONLY.has(t)) throw new AppendOnlyError(t, "update");
      if (!where.length) throw new DbError("21000", "update without a filter");
      return inner.update(ident(t), where, patch);
    },
    delete(t, where) {
      if (APPEND_ONLY.has(t)) throw new AppendOnlyError(t, "delete");
      if (!DELETABLE.has(t)) throw new DbError("42501", `delete is not permitted on ${t}`, 403);
      if (!where.length) throw new DbError("21000", "delete without a filter");
      return inner.delete(ident(t), where);
    },
  };
}

// ---------------------------------------------------------------------------------------
// PostgREST adapter (service role; RLS has no policies for these tables by design).

function encodeValue(op: string, v: unknown): string {
  if (op === "in") {
    const items = (v as unknown[]).map((x) => {
      const s = String(x);
      return /[,()"\s]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
    });
    return `in.(${items.join(",")})`;
  }
  if (op === "is") return `is.${v === null ? "null" : String(v)}`;
  return `${op}.${v instanceof Date ? v.toISOString() : String(v)}`;
}

export function buildQuery(opts: SelectOpts = {}): URLSearchParams {
  const q = new URLSearchParams();
  if (opts.columns) q.set("select", opts.columns.map(ident).join(","));
  for (const [op, col, val] of opts.where ?? []) q.append(ident(col), encodeValue(op, val));
  if (opts.order?.length) {
    q.set("order", opts.order.map(([c, d]) => `${ident(c)}.${d}`).join(","));
  }
  if (opts.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts.offset !== undefined) q.set("offset", String(opts.offset));
  return q;
}

export function postgrestDb(url: string, serviceKey: string, fetcher: typeof fetch = fetch): Db {
  const base = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  async function call(method: string, table: string, q: URLSearchParams, body?: unknown, prefer?: string) {
    const res = await fetcher(`${base}/${table}?${q}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let code = String(res.status);
      let message = res.statusText;
      try {
        const e = await res.json();
        code = e.code ?? code;
        message = e.message ?? message;
      } catch { /* non-JSON error body */ }
      throw new DbError(code, message, res.status);
    }
    return res;
  }

  const db: Db = {
    async select(table, opts) {
      const res = await call("GET", table, buildQuery(opts));
      return await res.json();
    },
    async selectAll(table, opts = {}) {
      const page = 1000;
      const out: Row[] = [];
      for (let offset = 0; offset < 200_000; offset += page) {
        const rows = await db.select(table, { ...opts, limit: page, offset });
        out.push(...rows);
        if (rows.length < page) break;
      }
      return out;
    },
    async count(table, where = []) {
      const q = buildQuery({ where, limit: 1 });
      q.set("select", "*");
      const res = await call("GET", table, q, undefined, "count=exact");
      const range = res.headers.get("content-range") ?? "*/0";
      await res.body?.cancel();
      return Number(range.split("/")[1]) || 0;
    },
    async insert(table, rows) {
      const res = await call("POST", table, new URLSearchParams(), rows, "return=representation");
      return await res.json();
    },
    async update(table, where, patch) {
      const res = await call("PATCH", table, buildQuery({ where }), patch, "return=representation");
      return await res.json();
    },
    async delete(table, where) {
      const res = await call("DELETE", table, buildQuery({ where }), undefined, "return=representation");
      return await res.json();
    },
  };
  return db;
}

export type { Db, Row, Where };
