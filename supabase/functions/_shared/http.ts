// The request pipeline every admin Edge Function runs through:
//   CORS → POST only → bearer token → GoTrue user → allowed email domain →
//   ACTIVE team_members row → action →
//   the action's own role list → run.
// The role check here is the server half of rule 3. It never trusts anything the browser
// says about who the caller is or what role they hold.

import { allowedDomain, inAllowedDomain } from "./email_domain.js";
import { DbError, HttpError } from "./errors.ts";
import type { Actor, Ctx, Deps, FunctionSpec, Role, Row } from "./types.ts";
import { ROLES } from "./types.ts";

const MAX_BODY = 512 * 1024;

function corsHeaders(req: Request, deps: Deps): Record<string, string> {
  const allowed = (deps.env("ADMIN_ORIGIN") ?? "https://admin.avidproblemsolvers.com")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

/** Country from the edge's own header. IP headers are never read (rule 6). */
export function countryOf(req: Request): string | null {
  const c = (req.headers.get("cf-ipcountry") ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}

export async function authenticate(req: Request, deps: Deps): Promise<Actor> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // One error for every failure mode: no hint whether an address exists.
  const denied = new HttpError(403, "not_authorised");
  if (!token) throw denied;
  const user = await deps.auth.getUser(token);
  if (!user) throw denied;
  // Domain lock, before team_members is even read: an off-domain account is refused
  // whatever role its row claims, with the same response as an unknown one.
  const domain = allowedDomain(deps.env("ALLOWED_EMAIL_DOMAIN"));
  if (!inAllowedDomain(user.email, domain)) throw denied;
  const rows = await deps.db.select("team_members", {
    columns: ["id", "email", "full_name", "role", "active"],
    where: [["eq", "id", user.id], ["eq", "active", true]],
    limit: 1,
  });
  const m = rows[0];
  if (!m || m.active !== true || !ROLES.includes(m.role as Role)) throw denied;
  if (!inAllowedDomain(m.email, domain)) throw denied;
  return {
    id: String(m.id),
    email: String(m.email),
    role: m.role as Role,
    full_name: (m.full_name as string | null) ?? null,
    country: countryOf(req),
  };
}

export async function serve(spec: FunctionSpec, req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req, deps);
  const withCors = (r: Response) => {
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    return r;
  };
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
  if (req.method !== "POST") return withCors(json({ error: "method_not_allowed" }, 405));

  try {
    const actor = await authenticate(req, deps);

    const raw = await req.text();
    if (raw.length > MAX_BODY) throw new HttpError(413, "payload_too_large");
    let body: Row;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError(400, "invalid_json");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new HttpError(400, "invalid_json");
    }

    const name = typeof body.action === "string" ? body.action : "";
    const action = Object.hasOwn(spec.actions, name) ? spec.actions[name] : undefined;
    if (!action) throw new HttpError(400, "unknown_action");
    if (!action.roles.includes(actor.role)) throw new HttpError(403, "forbidden");

    const ctx: Ctx = { actor, deps, body };
    const out = await action.run(ctx);
    return withCors(out instanceof Response ? out : json(out ?? { ok: true }));
  } catch (e) {
    if (e instanceof HttpError) {
      return withCors(json({ error: e.code, message: e.message !== e.code ? e.message : undefined }, e.status));
    }
    if (e instanceof DbError && e.code === "23505") {
      return withCors(json({ error: "conflict", message: "That value is already taken." }, 409));
    }
    if (e instanceof DbError && e.status === 403) {
      return withCors(json({ error: "forbidden", message: e.message }, 403));
    }
    console.error(`[${spec.name}]`, e);
    return withCors(json({ error: "internal" }, 500));
  }
}

// --- small input helpers ---------------------------------------------------------------

export function str(body: Row, key: string, opts: { max?: number; required?: boolean } = {}): string {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new HttpError(400, "invalid_input", `${key} is required`);
    return "";
  }
  if (typeof v !== "string") throw new HttpError(400, "invalid_input", `${key} must be text`);
  if (opts.max && v.length > opts.max) {
    throw new HttpError(400, "invalid_input", `${key} is longer than ${opts.max} characters`);
  }
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(body: Row, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, "invalid_input", `${key} must be an id`);
  return v;
}

export function isoDate(body: Row, key: string): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, "invalid_input", `${key} must be a date`);
  }
  return new Date(v).toISOString();
}

// --- CSV ---------------------------------------------------------------------------------

export function csv(filename: string, columns: string[], rows: Row[]): Response {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = Array.isArray(v) ? v.join("; ") : String(v);
    // Neutralise spreadsheet formula injection from user-supplied text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))];
  return new Response(lines.join("\r\n") + "\r\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
