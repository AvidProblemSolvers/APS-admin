// The domain lock: every Edge Function refuses any signed-in user whose email is outside
// ALLOWED_EMAIL_DOMAIN, before team_members is read and whatever role that row claims.
// These calls go straight to serve() with a bearer token — the sign-in page is bypassed
// entirely, so its own domain check plays no part.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedDomain, DEFAULT_EMAIL_DOMAIN, inAllowedDomain } from "../supabase/functions/_shared/email_domain.js";
import type { TestDeps } from "../mock/fakes.ts";
import { call, fresh, withOutsider, type Who } from "./helpers.ts";
import { EXPECTED } from "./matrix.ts";

const EVERY = Object.entries(EXPECTED).flatMap(([fn, actions]) => Object.keys(actions).map((a) => [fn, a] as const));

/** Records every table the data layer is asked to read. */
function spyReads(deps: TestDeps): string[] {
  const read: string[] = [];
  const select = deps.db.select.bind(deps.db);
  deps.db.select = (table, q) => {
    read.push(table);
    return select(table, q);
  };
  return read;
}

describe("email domain", () => {
  it("matches the exact domain only", () => {
    assert.equal(DEFAULT_EMAIL_DOMAIN, "@avidproblemsolvers.com");
    assert.equal(allowedDomain(undefined), DEFAULT_EMAIL_DOMAIN);
    assert.equal(allowedDomain("  "), DEFAULT_EMAIL_DOMAIN);
    assert.equal(allowedDomain("Example.com"), "@example.com");
    assert.equal(allowedDomain("@example.com"), "@example.com");
    assert.ok(inAllowedDomain("Owner@AvidProblemSolvers.com", undefined));
    for (const e of [
      "owner@example.com", "owner@evil.avidproblemsolvers.com", "owner@avidproblemsolvers.com.evil.io",
      "owner@xavidproblemsolvers.com", "@avidproblemsolvers.com", "a@b@avidproblemsolvers.com", "", null,
    ]) assert.ok(!inAllowedDomain(e, undefined), String(e));
  });
});

describe("domain lock (server)", () => {
  for (const [fn, action] of EVERY) {
    it(`${fn}.${action} refuses an off-domain ACTIVE OWNER, without reading team_members`, async () => {
      const deps = withOutsider(fresh());
      const read = spyReads(deps);
      const before = deps.mem.log.length;
      const r = await call(deps, fn, "outsider", { action });
      assert.equal(r.status, 403);
      assert.equal(r.json.error, "not_authorised");
      assert.deepEqual(read, [], "refused before any table is read");
      assert.equal(deps.mem.log.length, before, "a refused call must write nothing");
    });

    it(`${fn}.${action} refuses an on-domain user who is not on the team`, async () => {
      const r = await call(fresh(), fn, "newcomer", { action });
      assert.equal(r.status, 403);
      assert.equal(r.json.error, "not_authorised");
    });

    it(`${fn}.${action} still admits an on-domain active owner`, async () => {
      const r = await call(fresh(), fn, "owner", { action });
      assert.notEqual(r.status, 403, r.text);
    });
  }

  it("off-domain, unknown, on-domain-unknown, inactive and anonymous all get the identical response", async () => {
    const deps = withOutsider(fresh());
    const bodies = await Promise.all((["outsider", "newcomer", "stranger", "inactive", "anonymous"] as Who[]).map(async (w) => {
      const r = await call(deps, "admin-me", w, { action: "me" });
      return `${r.status} ${r.text}`;
    }));
    assert.equal(new Set(bodies).size, 1, bodies.join("\n"));
  });

  it("lookalike domains are refused even with an active owner row", async () => {
    for (const email of ["boss@evil.avidproblemsolvers.com", "boss@avidproblemsolvers.com.evil.io", "boss@xavidproblemsolvers.com"]) {
      const r = await call(withOutsider(fresh(), email), "admin-me", "outsider", { action: "me" });
      assert.equal(r.status, 403, email);
    }
  });

  it("on-domain members work as before, case-insensitively", async () => {
    const deps = fresh();
    for (const who of ["owner", "admin", "team"] as Who[]) {
      const r = await call(deps, "admin-me", who, { action: "me" });
      assert.equal(r.status, 200);
      assert.equal(r.json.role, who);
    }
    const upper = withOutsider(fresh(), "Boss@AvidProblemSolvers.COM");
    assert.equal((await call(upper, "admin-me", "outsider", { action: "me" })).status, 200);
  });

  it("ALLOWED_EMAIL_DOMAIN overrides the default", async () => {
    const deps = withOutsider(fresh({ ALLOWED_EMAIL_DOMAIN: "example.com" }));
    assert.equal((await call(deps, "admin-me", "outsider", { action: "me" })).status, 200);
    assert.equal((await call(deps, "admin-me", "owner", { action: "me" })).status, 403);
  });

  it("a team row's email must also be on-domain, even if the auth account's is", async () => {
    const deps = fresh();
    deps.mem.tables.team_members.find((m) => m.role === "owner")!.email = "owner@example.com";
    assert.equal((await call(deps, "admin-me", "owner", { action: "me" })).status, 403);
  });
});
