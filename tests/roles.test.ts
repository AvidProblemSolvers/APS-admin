// Rule 3: every Edge Function enforces roles itself, per action. This matrix is written
// out independently from the handlers (from SPEC §8) — if a handler's role list drifts
// from it, these tests fail.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { call, FUNCTIONS, fresh, type Who } from "./helpers.ts";
import { ALL, EXPECTED } from "./matrix.ts";


describe("role matrix", () => {
  it("every deployed function and action is in the expected matrix, and vice versa", () => {
    assert.deepEqual(Object.keys(FUNCTIONS).sort(), Object.keys(EXPECTED).sort());
    for (const [fn, spec] of Object.entries(FUNCTIONS)) {
      assert.deepEqual(Object.keys(spec.actions).sort(), Object.keys(EXPECTED[fn]).sort(), fn);
      for (const [a, action] of Object.entries(spec.actions)) {
        assert.deepEqual([...action.roles].sort(), [...EXPECTED[fn][a]].sort(), `${fn}.${a}`);
      }
    }
  });

  for (const [fn, actions] of Object.entries(EXPECTED)) {
    for (const [action, allowed] of Object.entries(actions)) {
      for (const role of ALL) {
        if (allowed.includes(role)) continue;
        it(`${fn}.${action} refuses ${role} server-side with 403`, async () => {
          const deps = fresh();
          const before = deps.mem.log.length;
          const r = await call(deps, fn, role as Who, { action });
          assert.equal(r.status, 403);
          assert.equal(r.json.error, "forbidden");
          assert.equal(deps.mem.log.length, before, "a refused call must write nothing");
        });
      }
      for (const who of ["inactive", "stranger", "anonymous"] as Who[]) {
        it(`${fn}.${action} refuses ${who}`, async () => {
          const deps = fresh();
          const r = await call(deps, fn, who, { action });
          assert.equal(r.status, 403);
          assert.equal(r.json.error, "not_authorised");
        });
      }
    }
  }

  it("a team member calling a content write directly is refused and nothing changes", async () => {
    const deps = fresh();
    const before = JSON.stringify(deps.mem.tables.site_content);
    const r = await call(deps, "admin-content", "team", { action: "save", changes: { "hero.eyebrow": "HACKED" } });
    assert.equal(r.status, 403);
    assert.equal(JSON.stringify(deps.mem.tables.site_content), before);
  });

  it("a forged role in the request body is ignored", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-team", "team", { action: "list", role: "owner" });
    assert.equal(r.status, 403);
  });

  it("deactivating a member locks them out on their very next call, even with a live token", async () => {
    const deps = fresh();
    assert.equal((await call(deps, "admin-me", "admin", { action: "me" })).status, 200);
    const off = await call(deps, "admin-team", "owner", { action: "set_active", member_id: "00000000-0000-4000-8000-000000000003", active: false });
    assert.equal(off.status, 200);
    assert.equal((await call(deps, "admin-me", "admin", { action: "me" })).status, 403);
  });
});

describe("request pipeline", () => {
  it("every unauthorised caller gets the identical response — no hint whether an address exists", async () => {
    const deps = fresh();
    const bodies = await Promise.all((["inactive", "stranger", "anonymous"] as Who[]).map(async (w) => {
      const r = await call(deps, "admin-me", w, { action: "me" });
      return `${r.status} ${r.text}`;
    }));
    assert.equal(new Set(bodies).size, 1);
  });

  it("OPTIONS preflight is answered for the admin origin only", async () => {
    const deps = fresh();
    const spec = FUNCTIONS["admin-me"];
    const { serve } = await import("../supabase/functions/_shared/http.ts");
    const ok = await serve(spec, new Request("https://x/f", { method: "OPTIONS", headers: { origin: "https://admin.avidproblemsolvers.com" } }), deps);
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://admin.avidproblemsolvers.com");
    const evil = await serve(spec, new Request("https://x/f", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps);
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
  });

  it("GET is refused, unknown actions are refused, prototype keys are not actions", async () => {
    const deps = fresh();
    const { serve } = await import("../supabase/functions/_shared/http.ts");
    const get = await serve(FUNCTIONS["admin-me"], new Request("https://x/f", { method: "GET" }), deps);
    assert.equal(get.status, 405);
    assert.equal((await call(deps, "admin-audit", "owner", { action: "delete" })).status, 400);
    assert.equal((await call(deps, "admin-audit", "owner", { action: "constructor" })).status, 400);
    assert.equal((await call(deps, "admin-audit", "owner", { action: "__proto__" })).status, 400);
  });

  it("responses are marked noindex and no-store", async () => {
    const r = await call(fresh(), "admin-me", "owner", { action: "me" });
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(r.headers.get("cache-control"), "no-store");
  });

  it("audit rows record the edge country, and nothing resembling an IP", async () => {
    const deps = fresh();
    await call(deps, "admin-content", "admin", { action: "save", changes: { "hero.eyebrow": "OPS" } }, { country: "in" });
    const row = deps.mem.tables.audit_log.at(-1)!;
    assert.equal(row.actor_country, "IN");
    assert.ok(!Object.keys(row).some((k) => /ip/i.test(k) && k !== "actor_id"));
  });
});
