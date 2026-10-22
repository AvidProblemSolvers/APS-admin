// Production adapters, exercised with a recording fetch. Nothing here touches the network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { github, gotrue } from "../supabase/functions/_shared/adapters.ts";
import { buildQuery, guardDb, postgrestDb } from "../supabase/functions/_shared/db.ts";

function recorder(respond: (url: string, init: RequestInit) => Response = () => Response.json([])) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (u: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(u), init });
    return respond(String(u), init);
  }) as typeof fetch;
  return { calls, f };
}

describe("PostgREST adapter", () => {
  it("builds filters, ordering and paging", () => {
    const q = buildQuery({
      columns: ["id", "created_at"],
      where: [["gte", "created_at", "2026-10-01T00:00:00Z"], ["lt", "created_at", "2026-11-01T00:00:00Z"], ["in", "status", ["a", "b c"]], ["is", "slot_start", null]],
      order: [["created_at", "desc"]],
      limit: 10,
      offset: 20,
    });
    assert.equal(
      decodeURIComponent(q.toString()).replace(/\+/g, " "),
      'select=id,created_at&created_at=gte.2026-10-01T00:00:00Z&created_at=lt.2026-11-01T00:00:00Z&status=in.(a,"b c")&slot_start=is.null&order=created_at.desc&limit=10&offset=20',
    );
  });

  it("rejects identifiers that are not plain column names", () => {
    assert.throws(() => buildQuery({ columns: ["id,amount"] }));
    assert.throws(() => buildQuery({ where: [["eq", "id;drop", 1]] }));
  });

  it("uses the service role key and asks for representation on writes", async () => {
    const { calls, f } = recorder();
    const db = guardDb(postgrestDb("https://p.supabase.co", "SERVICE", f));
    await db.update("bookings", [["eq", "id", "x"]], { scheduled: true });
    assert.equal(calls[0].init.method, "PATCH");
    assert.match(calls[0].url, /\/rest\/v1\/bookings\?id=eq\.x$/);
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h.Authorization, "Bearer SERVICE");
    assert.equal(h.Prefer, "return=representation");
  });

  it("refuses an unfiltered update", () => {
    const db = guardDb(postgrestDb("https://p", "k", recorder().f));
    assert.throws(() => db.update("bookings", [], { scheduled: true }), /without a filter/);
  });

  it("pages through large tables 1000 rows at a time", async () => {
    let n = 0;
    const { calls, f } = recorder(() => Response.json(Array.from({ length: n++ < 2 ? 1000 : 3 }, () => ({}))));
    const rows = await postgrestDb("https://p", "k", f).selectAll("page_views", { columns: ["id"] });
    assert.equal(rows.length, 2003);
    assert.equal(calls.length, 3);
    assert.match(calls[2].url, /offset=2000/);
  });
});

describe("GoTrue adapter", () => {
  it("magic links never create users", async () => {
    const { calls, f } = recorder(() => new Response("{}", { status: 200 }));
    await gotrue("https://p.supabase.co", "k", f).sendMagicLink("a@b.c", "https://admin.avidproblemsolvers.com/");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { email: "a@b.c", create_user: false });
    assert.match(calls[0].url, /\/auth\/v1\/otp\?redirect_to=https%3A%2F%2Fadmin\.avidproblemsolvers\.com%2F$/);
  });

  it("deactivation bans via the admin API", async () => {
    const { calls, f } = recorder(() => Response.json({}));
    await gotrue("https://p", "k", f).setBanned("u1", true);
    assert.equal(calls[0].init.method, "PUT");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { ban_duration: "876000h" });
  });

  it("an invalid token is simply no user", async () => {
    const { f } = recorder(() => new Response("{}", { status: 401 }));
    assert.equal(await gotrue("https://p", "k", f).getUser("bad"), null);
  });
});

describe("GitHub adapter", () => {
  it("fires repository_dispatch at the site repo with the PAT", async () => {
    const { calls, f } = recorder(() => new Response(null, { status: 204 }));
    const env = (k: string) => ({ GITHUB_PAT: "ghp_x", GITHUB_SITE_REPO: "AvidProblemSolvers/APS-site" } as Record<string, string>)[k];
    await github(env, f).dispatch("publish", { by: "a@b.c" });
    assert.equal(calls[0].url, "https://api.github.com/repos/AvidProblemSolvers/APS-site/dispatches");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer ghp_x");
    assert.equal(JSON.parse(String(calls[0].init.body)).event_type, "publish");
  });
});
