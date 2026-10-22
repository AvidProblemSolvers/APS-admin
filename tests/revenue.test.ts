// Rule 5: revenue is omitted SERVER-SIDE for admin and team. Checked three ways:
//   1. response bodies of every action admin/team can call contain no amount and no revenue,
//   2. the SQL that production would send (PostgREST URL) never selects amount for them,
//   3. the owner does get it, and the monthly figure is right.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { guardDb, postgrestDb } from "../supabase/functions/_shared/db.ts";
import { serve } from "../supabase/functions/_shared/http.ts";
import { makeDeps } from "../mock/fakes.ts";
import { LEAK_AMOUNTS, seed } from "../mock/seed.ts";
import { call, FUNCTIONS, fresh, IDS, NOW, type Who } from "./helpers.ts";
import { EXPECTED } from "./matrix.ts";

function assertNoRevenue(text: string, where: string) {
  assert.ok(!/"amount"/.test(text), `${where}: "amount" key leaked`);
  assert.ok(!/revenue/i.test(text), `${where}: revenue leaked`);
  assert.ok(!/"currency"/.test(text), `${where}: currency leaked`);
  for (const a of LEAK_AMOUNTS) {
    const s = String(a);
    assert.ok(!text.includes(s) && !text.includes(s.replace(".", "")), `${where}: amount ${s} leaked`);
  }
}

const BODIES: Record<string, Record<string, unknown>> = {
  "admin-bookings.list": {},
  "admin-bookings.detail": { booking_id: IDS.bookingUpcoming },
  "admin-bookings.email_link": { booking_id: IDS.bookingPaidUnscheduled },
  "admin-slot-requests.list": { status: "all" },
  "admin-slot-requests.decline": { request_id: IDS.request1 },
  "admin-signals.list": {},
  "admin-traffic.summary": { days: 90 },
  "admin-availability.get": {},
  "admin-content.list": {},
  "admin-answers.list": {},
  "admin-settings.get": {},
  "admin-me.me": {},
  "trigger-publish.status": {},
};

describe("revenue is owner-only, enforced on the server", () => {
  for (const role of ["admin", "team"] as Who[]) {
    for (const [fn, actions] of Object.entries(EXPECTED)) {
      for (const [action, allowed] of Object.entries(actions)) {
        if (!allowed.includes(role)) continue;
        const key = `${fn}.${action}`;
        if (!(key in BODIES)) continue;
        it(`${key} as ${role} returns no revenue`, async () => {
          const r = await call(fresh(), fn, role, { action, ...BODIES[key] });
          assert.ok(r.status < 500, `${key}: ${r.status} ${r.text}`);
          assertNoRevenue(r.text, `${key} as ${role}`);
        });
      }
    }
  }

  it("every read action admin or team can call is covered by the sweep above", () => {
    for (const [fn, actions] of Object.entries(EXPECTED)) {
      for (const [action, allowed] of Object.entries(actions)) {
        const reads = !/save|approve|invite|set_|publish|add_|remove_|resend/.test(action);
        if (reads && (allowed.includes("admin") || allowed.includes("team"))) {
          assert.ok(`${fn}.${action}` in BODIES, `${fn}.${action} not swept`);
        }
      }
    }
  });

  it("the owner sees amounts and this month's revenue (IST month, captured only)", async () => {
    const r = await call(fresh(), "admin-bookings", "owner", { action: "list" });
    assert.equal(r.status, 200);
    const rows = r.json.rows as Record<string, unknown>[];
    assert.ok(rows.every((x) => typeof x.amount === "number"));
    const stats = r.json.stats as Record<string, Record<string, number>>;
    // October 2026 bookings: the four created within the last 9 days; the 30-day-old one is September.
    const expected = Math.round((LEAK_AMOUNTS[0] + LEAK_AMOUNTS[1] + LEAK_AMOUNTS[2] + LEAK_AMOUNTS[3]) * 100) / 100;
    assert.deepEqual(stats.revenue_month, { USD: expected });
  });

  it("for admin, the production query itself never selects amount or currency", async () => {
    const urls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const u = new URL(url);
      const table = u.pathname.split("/").pop()!;
      const mem = makeDeps(seed(), { now: () => NOW });
      if (table === "team_members") {
        return Response.json(mem.mem.tables.team_members.filter((m) => m.id === IDS.admin));
      }
      if (table === "bookings") {
        const cols = (u.searchParams.get("select") ?? "").split(",");
        return Response.json(mem.mem.tables.bookings.map((b) => Object.fromEntries(cols.map((c) => [c, b[c] ?? null]))));
      }
      return Response.json([]);
    }) as typeof fetch;
    const base = makeDeps(seed(), { now: () => NOW });
    const deps = { ...base, db: guardDb(postgrestDb("https://x.supabase.co", "service", fakeFetch)) };
    const res = await serve(FUNCTIONS["admin-bookings"], new Request("https://x/f", {
      method: "POST",
      headers: { authorization: `Bearer token-${IDS.admin}` },
      body: JSON.stringify({ action: "list" }),
    }), deps);
    assert.equal(res.status, 200);
    const bookingQueries = urls.filter((u) => u.includes("/rest/v1/bookings"));
    assert.ok(bookingQueries.length > 0);
    for (const u of bookingQueries) {
      const select = new URL(u).searchParams.get("select") ?? "*";
      assert.notEqual(select, "*", "bookings must never be selected with *");
      assert.ok(!select.split(",").includes("amount"), `amount selected: ${u}`);
      assert.ok(!select.split(",").includes("currency"), `currency selected: ${u}`);
    }
    assertNoRevenue(await res.text(), "postgrest admin list");
  });

  it("CSV export is owner-only and includes amounts for the owner", async () => {
    const deps = fresh();
    assert.equal((await call(deps, "admin-bookings", "admin", { action: "export_csv" })).status, 403);
    const r = await call(deps, "admin-bookings", "owner", { action: "export_csv" });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
    assert.ok(r.text.startsWith("created_at,payer_name,payer_email,amount"));
    assert.ok(r.text.includes(String(LEAK_AMOUNTS[0])));
  });
});
