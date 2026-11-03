// Traffic pane: aggregates over page_views. Only aggregate counts leave the server —
// never individual rows, never session ids.

import { HttpError } from "../_shared/errors.ts";
import { isoDate } from "../_shared/http.ts";
import { IST } from "../_shared/format.ts";
import { localDate } from "../_shared/slots.ts";
import type { Ctx, FunctionSpec, Row } from "../_shared/types.ts";

export const AI_REFERRERS = ["Claude", "ChatGPT", "Perplexity"];
const DAY = 86_400_000;
const MAX_DAYS = 366;

/** UTC ms of the IST midnight that starts the IST calendar day containing `ms`. */
const istMidnight = (ms: number) => Date.parse(`${localDate(ms, IST)}T00:00:00+05:30`);

/**
 * The period asked for: a preset (`days`: rolling, ending now) or a custom range (`from`,
 * `to`: IST midnights, `to` exclusive, ending no later than tonight's IST midnight).
 */
function period(body: Row, now: Date): { since: Date; until: Date | null; days: number } {
  if (body.from === undefined && body.to === undefined) {
    const days = Number(body.days ?? 30);
    if (![7, 30, 90].includes(days)) throw new HttpError(400, "invalid_input", "days must be 7, 30 or 90");
    return { since: new Date(now.getTime() - days * DAY), until: null, days };
  }
  const from = isoDate(body, "from"), to = isoDate(body, "to");
  if (!from || !to) throw new HttpError(400, "invalid_input", "from and to are both required");
  const s = Date.parse(from), u = Date.parse(to);
  if (istMidnight(s) !== s || istMidnight(u) !== u) throw new HttpError(400, "invalid_input", "from and to must be IST midnights");
  if (u <= s) throw new HttpError(400, "invalid_input", "to must be after from");
  if (u > istMidnight(now.getTime()) + DAY) throw new HttpError(400, "invalid_input", "the range cannot end after today (IST)");
  const days = Math.round((u - s) / DAY);
  if (days > MAX_DAYS) throw new HttpError(400, "invalid_input", `the range cannot exceed ${MAX_DAYS} days`);
  return { since: new Date(s), until: new Date(u), days };
}

function tally(rows: Row[], key: (r: Row) => string | null, top = 20) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top)
    .map(([label, count]) => ({ label, count }));
}

async function summary(ctx: Ctx) {
  const now = ctx.deps.now();
  const { since, until, days } = period(ctx.body, now);
  const prevSince = new Date(since.getTime() - days * DAY);

  const all = await ctx.deps.db.selectAll("page_views", {
    columns: ["country", "referrer", "utm_source", "utm_medium", "utm_campaign", "path", "session_id", "created_at"],
    where: until
      ? [["gte", "created_at", prevSince.toISOString()], ["lt", "created_at", until.toISOString()]]
      : [["gte", "created_at", prevSince.toISOString()]],
  });
  const cur = all.filter((r) => Date.parse(String(r.created_at)) >= since.getTime());
  const prev = all.filter((r) => Date.parse(String(r.created_at)) < since.getTime());

  // Daily series on IST calendar days, with zero-filled gaps.
  const counts = new Map<string, number>();
  for (const r of cur) {
    const d = localDate(Date.parse(String(r.created_at)), IST);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  // A preset ends today; a custom range ends on its last IST day.
  const last = until ? until.getTime() - DAY : now.getTime();
  const daily: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = localDate(last - i * DAY, IST);
    daily.push({ date: d, count: counts.get(d) ?? 0 });
  }

  const ai = AI_REFERRERS.map((label) => ({
    label,
    count: cur.filter((r) => r.referrer === label).length,
    previous: prev.filter((r) => r.referrer === label).length,
  }));

  return {
    days,
    since: since.toISOString(),
    until: until?.toISOString() ?? null,
    views: cur.length,
    previous_views: prev.length,
    sessions: new Set(cur.map((r) => r.session_id).filter(Boolean)).size,
    countries: tally(cur, (r) => (r.country as string) || "Unknown"),
    referrers: tally(cur, (r) => (r.referrer as string) || "Direct"),
    campaigns: tally(cur, (r) =>
      r.utm_campaign ? `${r.utm_campaign} · ${r.utm_source ?? "?"} / ${r.utm_medium ?? "?"}` : null),
    paths: tally(cur, (r) => (r.path as string) || null, 10),
    ai,
    daily,
  };
}

export const spec: FunctionSpec = {
  name: "admin-traffic",
  actions: {
    summary: { roles: ["owner", "admin", "team"], run: summary },
  },
};
