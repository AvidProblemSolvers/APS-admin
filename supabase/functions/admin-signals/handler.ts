// Signals pane: probe_queries as a readable list. No personal data exists in this table and
// none is selected: session_id stays server-side.

import { isoDate, str } from "../_shared/http.ts";
import type { Ctx, FunctionSpec, Where } from "../_shared/types.ts";

const COLUMNS = ["id", "problem_text", "business_text", "goal_text", "verdict", "country", "referrer", "converted", "created_at"];

async function list(ctx: Ctx) {
  const b = ctx.body;
  const where: Where = [];
  const verdict = str(b, "verdict", { max: 40 });
  if (verdict) where.push(["eq", "verdict", verdict]);
  if (b.converted === true) where.push(["eq", "converted", true]);
  if (b.converted === false) where.push(["eq", "converted", false]);
  const country = str(b, "country", { max: 2 }).toUpperCase();
  if (country) where.push(["eq", "country", country]);
  const from = isoDate(b, "from");
  const to = isoDate(b, "to");
  if (from) where.push(["gte", "created_at", from]);
  if (to) where.push(["lt", "created_at", to]);
  const q = str(b, "q", { max: 200 }).replace(/[%*,()]/g, " ").trim();
  if (q) where.push(["ilike", "problem_text", `%${q}%`]);

  const limit = 100;
  const offset = Math.max(0, Math.min(Number(b.offset) || 0, 100_000));
  const { db } = ctx.deps;
  const [rows, total, facetsRaw] = await Promise.all([
    db.select("probe_queries", { columns: COLUMNS, where, order: [["created_at", "desc"]], limit, offset }),
    db.count("probe_queries", where),
    db.selectAll("probe_queries", { columns: ["verdict", "country", "converted"] }),
  ]);
  const verdicts = [...new Set(facetsRaw.map((r) => r.verdict).filter(Boolean))].sort();
  const countries = [...new Set(facetsRaw.map((r) => r.country).filter(Boolean))].sort();
  const converted = facetsRaw.filter((r) => r.converted === true).length;
  return { rows, total, offset, limit, facets: { verdicts, countries, converted, all: facetsRaw.length } };
}

export const spec: FunctionSpec = {
  name: "admin-signals",
  actions: {
    list: { roles: ["owner", "admin", "team"], run: list },
  },
};
