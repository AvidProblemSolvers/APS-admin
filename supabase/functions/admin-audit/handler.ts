// Audit pane (owner only). READ-ONLY BY DESIGN: this function has exactly two actions,
// list and export_csv. There is no edit or delete action, and none may be added — the
// audit log is append-only for everyone, including the owner (CLAUDE.md hard rule 2).

import { csv, isoDate, str } from "../_shared/http.ts";
import type { Ctx, FunctionSpec, Where } from "../_shared/types.ts";

const COLUMNS = ["id", "created_at", "actor_email", "action", "target", "old_value", "new_value", "actor_country"];

function filters(ctx: Ctx): Where {
  const b = ctx.body;
  const where: Where = [];
  const safe = (s: string) => s.replace(/[%*,()]/g, " ").trim();
  const action = safe(str(b, "action_prefix", { max: 80 }));
  if (action) where.push(["ilike", "action", `${action}%`]);
  const actor = safe(str(b, "actor", { max: 254 }));
  if (actor) where.push(["ilike", "actor_email", `%${actor}%`]);
  const target = safe(str(b, "q", { max: 200 }));
  if (target) where.push(["ilike", "target", `%${target}%`]);
  const from = isoDate(b, "from");
  const to = isoDate(b, "to");
  if (from) where.push(["gte", "created_at", from]);
  if (to) where.push(["lt", "created_at", to]);
  return where;
}

async function list(ctx: Ctx) {
  const where = filters(ctx);
  const limit = 100;
  const offset = Math.max(0, Math.min(Number(ctx.body.offset) || 0, 1_000_000));
  const { db } = ctx.deps;
  const [rows, total, actions] = await Promise.all([
    db.select("audit_log", { columns: COLUMNS, where, order: [["created_at", "desc"]], limit, offset }),
    db.count("audit_log", where),
    db.selectAll("audit_log", { columns: ["action"] }),
  ]);
  const families = [...new Set(actions.map((a) => String(a.action).split(".")[0]))].sort();
  return { rows, total, offset, limit, families };
}

async function exportCsv(ctx: Ctx) {
  const rows = await ctx.deps.db.selectAll("audit_log", { columns: COLUMNS, where: filters(ctx), order: [["created_at", "desc"]] });
  return csv(`aps-audit-${ctx.deps.now().toISOString().slice(0, 10)}.csv`, COLUMNS, rows);
}

export const spec: FunctionSpec = {
  name: "admin-audit",
  actions: {
    list: { roles: ["owner"], run: list },
    export_csv: { roles: ["owner"], run: exportCsv },
  },
};
