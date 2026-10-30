// Content pane: edit existing site_content keys. One audit row per changed field, with the
// old and new values. Nothing reaches the live site until Publish (trigger-publish).

import { audit } from "../_shared/audit.ts";
import { HttpError } from "../_shared/errors.ts";
import type { Ctx, FunctionSpec } from "../_shared/types.ts";

const MAX_VALUE = 10_000;

// Every column (select *), ordered by key only: the nullable display-order column reaches the
// pane when the site has added it, and naming it here would break an unmigrated database.
// The pane orders by it.
async function list(ctx: Ctx) {
  const rows = await ctx.deps.db.selectAll("site_content", { order: [["key", "asc"]] });
  return { rows };
}

async function save(ctx: Ctx) {
  const changes = ctx.body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new HttpError(400, "invalid_input", "changes must be an object");
  }
  const entries = Object.entries(changes as Record<string, unknown>);
  if (!entries.length) return { updated: [] };
  if (entries.length > 200) throw new HttpError(400, "invalid_input", "too many changes at once");

  const { db, now } = ctx.deps;
  const current = new Map(
    (await db.selectAll("site_content", { columns: ["key", "value"] })).map((r) => [String(r.key), String(r.value)]),
  );
  // Validate everything before writing anything.
  for (const [key, value] of entries) {
    if (!current.has(key)) throw new HttpError(400, "invalid_input", `unknown content key: ${key}`);
    if (typeof value !== "string") throw new HttpError(400, "invalid_input", `${key} must be text`);
    if (!value.trim()) throw new HttpError(400, "invalid_input", `${key} cannot be empty — the site never renders empty copy`);
    if (value.length > MAX_VALUE) throw new HttpError(400, "invalid_input", `${key} is too long`);
  }

  const updated: string[] = [];
  for (const [key, value] of entries as [string, string][]) {
    const old = current.get(key);
    if (old === value) continue;
    await db.update("site_content", [["eq", "key", key]], { value, updated_at: now().toISOString() });
    await audit(ctx, { action: "content.update", target: key, old_value: old, new_value: value });
    updated.push(key);
  }
  return { updated, rows: (await list(ctx)).rows };
}

export const spec: FunctionSpec = {
  name: "admin-content",
  actions: {
    list: { roles: ["owner", "admin"], run: list },
    save: { roles: ["owner", "admin"], run: save },
  },
};
