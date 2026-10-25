import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { call, fresh, IDS } from "./helpers.ts";

describe("team", () => {
  it("no sequence of team actions can leave zero active owners", async () => {
    const deps = fresh();
    deps.mem.tables.team_members.push({
      id: IDS.owner2, email: "owner2@avidproblemsolvers.com", role: "owner", active: true, created_at: "2026-01-01T00:00:00Z",
    });
    deps.fakeAuth.addUser({ id: IDS.owner2, email: "owner2@avidproblemsolvers.com" });
    const owners = () => deps.mem.tables.team_members.filter((m) => m.role === "owner" && m.active).length;

    // With two owners, one may demote the other…
    assert.equal((await call(deps, "admin-team", "owner", { action: "set_role", member_id: IDS.owner2, role: "admin" })).status, 200);
    assert.equal(owners(), 1);
    // …but the survivor cannot demote or deactivate themselves,
    assert.equal((await call(deps, "admin-team", "owner", { action: "set_role", member_id: IDS.owner, role: "admin" })).status, 409);
    assert.equal((await call(deps, "admin-team", "owner", { action: "set_active", member_id: IDS.owner, active: false })).status, 409);
    assert.equal(owners(), 1);
  });

  it("the last-owner guard holds even when two owners demote each other at the same moment", async () => {
    const deps = fresh();
    deps.mem.tables.team_members.push({
      id: IDS.owner2, email: "owner2@avidproblemsolvers.com", role: "owner", active: true, created_at: "2026-01-01T00:00:00Z",
    });
    deps.fakeAuth.addUser({ id: IDS.owner2, email: "owner2@avidproblemsolvers.com" });
    deps.fakeAuth.tokens.set("token-owner2", IDS.owner2);
    const [a, b] = await Promise.all([
      call(deps, "admin-team", "owner", { action: "set_role", member_id: IDS.owner2, role: "admin" }),
      call(deps, "admin-team", "owner2" as never, { action: "set_role", member_id: IDS.owner, role: "admin" }),
    ]);
    const owners = deps.mem.tables.team_members.filter((m) => m.role === "owner" && m.active).length;
    assert.ok(owners >= 1, `owners left: ${owners} (${a.status}/${b.status})`);
  });

  it("an owner cannot change their own role or deactivate themselves", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-team", "owner", { action: "set_role", member_id: IDS.owner, role: "admin" });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "own_role");
    const d = await call(deps, "admin-team", "owner", { action: "set_active", member_id: IDS.owner, active: false });
    assert.equal(d.status, 409);
  });

  it("deactivation bans the auth user and writes an audit row; reactivation reverses it", async () => {
    const deps = fresh();
    await call(deps, "admin-team", "owner", { action: "set_active", member_id: IDS.team, active: false });
    assert.ok(deps.fakeAuth.banned.has(IDS.team));
    assert.equal(deps.mem.tables.team_members.find((m) => m.id === IDS.team)!.active, false);
    assert.equal(deps.mem.tables.audit_log.at(-1)!.action, "team.deactivate");
    await call(deps, "admin-team", "owner", { action: "set_active", member_id: IDS.team, active: true });
    assert.ok(!deps.fakeAuth.banned.has(IDS.team));
    assert.equal(deps.mem.tables.audit_log.at(-1)!.action, "team.reactivate");
  });

  it("members are never deleted — the row survives deactivation", async () => {
    const deps = fresh();
    const n = deps.mem.tables.team_members.length;
    await call(deps, "admin-team", "owner", { action: "set_active", member_id: IDS.admin, active: false });
    assert.equal(deps.mem.tables.team_members.length, n);
  });

  it("invite creates the auth user, the team row with invited_by, and an audit row", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-team", "owner", { action: "invite", email: "New@AvidProblemSolvers.com", role: "team", full_name: "New Person" });
    assert.equal(r.status, 200, r.text);
    const row = deps.mem.tables.team_members.find((m) => m.email === "new@avidproblemsolvers.com")!;
    assert.equal(row.role, "team");
    assert.equal(row.invited_by, IDS.owner);
    assert.equal(deps.fakeAuth.invites[0].redirectTo, "https://admin.avidproblemsolvers.com/");
    assert.equal(deps.mem.tables.audit_log.at(-1)!.action, "team.invite");
  });

  it("inviting an existing auth account links it and sends a magic link instead", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-team", "owner", { action: "invite", email: "newcomer@avidproblemsolvers.com", role: "admin" });
    assert.equal(r.status, 200, r.text);
    assert.equal(deps.mem.tables.team_members.find((m) => m.email === "newcomer@avidproblemsolvers.com")!.id, IDS.newcomer);
    assert.equal(deps.fakeAuth.magicLinks[0].email, "newcomer@avidproblemsolvers.com");
  });

  it("inviting a current or former member is refused with a clear message", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-team", "owner", { action: "invite", email: "gone@avidproblemsolvers.com", role: "team" });
    assert.equal(r.status, 409);
    assert.match(String(r.json.message), /reactivate/);
  });

  it("rejects bad roles and bad emails", async () => {
    const deps = fresh();
    assert.equal((await call(deps, "admin-team", "owner", { action: "invite", email: "x@y.com", role: "superuser" })).status, 400);
    assert.equal((await call(deps, "admin-team", "owner", { action: "invite", email: "nope", role: "team" })).status, 400);
    assert.equal((await call(deps, "admin-team", "owner", { action: "set_role", member_id: IDS.team, role: "root" })).status, 400);
  });

  it("refuses to invite an address outside the allowed domain, and writes nothing", async () => {
    const deps = fresh();
    const n = deps.mem.tables.team_members.length;
    for (const email of ["new@example.com", "new@evil.avidproblemsolvers.com", "new@avidproblemsolvers.com.evil.io"]) {
      const r = await call(deps, "admin-team", "owner", { action: "invite", email, role: "team" });
      assert.equal(r.status, 400, email);
      assert.match(String(r.json.message), /@avidproblemsolvers\.com/);
    }
    assert.equal(deps.mem.tables.team_members.length, n);
    assert.equal(deps.fakeAuth.invites.length + deps.fakeAuth.magicLinks.length, 0);
  });
});
