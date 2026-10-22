// Settings pane: reads and writes site_settings (owner and admin).
// Every key is validated by settings_schema.js. This function writes NO audit_log row:
// the site repo's trigger on site_settings does that, attributing it via updated_by,
// which is why every write sets updated_by to the acting member's id.

import { HttpError } from "../_shared/errors.ts";
import { json } from "../_shared/http.ts";
import { publishSite } from "../_shared/publish.ts";
import { defaults, SETTINGS, validateChanges } from "../_shared/settings_schema.js";
import type { Ctx, FunctionSpec } from "../_shared/types.ts";

const KEYS = SETTINGS.map((s: { key: string }) => s.key);

async function read(ctx: Ctx) {
  const { db } = ctx.deps;
  const rows = await db.select("site_settings", { columns: ["key", "value", "updated_at", "updated_by"], where: [["in", "key", KEYS]] });
  const ids = [...new Set(rows.map((r) => r.updated_by).filter(Boolean))];
  const people = ids.length
    ? await db.select("team_members", { columns: ["id", "email"], where: [["in", "id", ids]] })
    : [];
  const email = new Map(people.map((p) => [p.id, p.email]));
  const values: Record<string, string> = {};
  const meta: Record<string, { updated_at: unknown; updated_by: unknown; stored: boolean }> = {};
  for (const r of rows) {
    values[String(r.key)] = String(r.value ?? "");
    meta[String(r.key)] = { updated_at: r.updated_at, updated_by: email.get(r.updated_by) ?? null, stored: true };
  }
  return { values: { ...defaults(), ...values }, stored: values, meta };
}

async function save(ctx: Ctx) {
  const changes = ctx.body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new HttpError(400, "invalid_input", "changes must be an object");
  }
  const { db, now } = ctx.deps;
  const { stored } = await read(ctx);
  const result = validateChanges(stored, changes as Record<string, unknown>);
  if (!result.ok) return json({ error: "invalid_input", errors: result.errors }, 400);

  const updated: string[] = [];
  for (const [key, value] of Object.entries(result.values as Record<string, string>)) {
    if (stored[key] === value) continue;
    const row = { value, updated_at: now().toISOString(), updated_by: ctx.actor.id };
    if (key in stored) await db.update("site_settings", [["eq", "key", key]], row);
    else await db.insert("site_settings", { key, ...row });
    updated.push(key);
  }

  let publish = null;
  if (updated.length && ctx.body.publish === true) publish = await publishSite(ctx, "settings");
  return { updated, publish, ...(await read(ctx)) };
}

export const spec: FunctionSpec = {
  name: "admin-settings",
  actions: {
    get: { roles: ["owner", "admin"], run: read },
    save: { roles: ["owner", "admin"], run: save },
  },
};
