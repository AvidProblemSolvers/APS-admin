// Hard rule 2: the audit log is append-only for everyone, including the owner.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { guardDb, postgrestDb } from "../supabase/functions/_shared/db.ts";
import { MemoryDb } from "../mock/memory_db.ts";
import { auditInserts, call, fresh, IDS } from "./helpers.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("audit log is append-only", () => {
  it("the data layer refuses UPDATE and DELETE on audit_log (memory adapter)", async () => {
    const db = guardDb(new MemoryDb({ audit_log: [{ actor_email: "x", action: "a" }] }));
    assert.throws(() => db.update("audit_log", [["eq", "action", "a"]], { action: "b" }), /append-only/);
    assert.throws(() => db.delete("audit_log", [["eq", "action", "a"]]), /append-only/);
  });

  it("the data layer refuses UPDATE and DELETE on audit_log before any request is made (PostgREST adapter)", () => {
    let calls = 0;
    const db = guardDb(postgrestDb("https://x.supabase.co", "k", (async () => {
      calls++;
      return Response.json([]);
    }) as typeof fetch));
    assert.throws(() => db.update("audit_log", [["eq", "id", "1"]], { action: "x" }), /append-only/);
    assert.throws(() => db.delete("audit_log", [["eq", "id", "1"]]), /append-only/);
    assert.equal(calls, 0);
  });

  it("hard deletes are impossible on every table except the two scheduling tables", () => {
    const db = guardDb(new MemoryDb());
    for (const t of ["team_members", "bookings", "answers", "site_content", "site_settings", "probe_queries", "page_views"]) {
      assert.throws(() => db.delete(t, [["eq", "id", "x"]]), /not permitted/, t);
    }
  });

  it("the audit function exposes exactly list and export_csv — to the owner only", async () => {
    const deps = fresh();
    for (const action of ["delete", "remove", "update", "edit", "purge", "truncate", "save", "set"]) {
      const r = await call(deps, "admin-audit", "owner", { action, id: "x" });
      assert.equal(r.status, 400, action);
    }
    assert.equal(deps.mem.tables.audit_log.length, 2);
  });

  it("no source file anywhere builds an update or delete against audit_log", () => {
    const roots = ["supabase/functions", "public/js", "mock", "scripts"];
    const offenders: string[] = [];
    for (const root of roots) {
      let list: string[] = [];
      try {
        list = files(root);
      } catch {
        continue;
      }
      for (const f of list.filter((x) => /\.(ts|js|mjs)$/.test(x))) {
        const src = readFileSync(f, "utf8");
        const re = /\b(update|delete)\(\s*["'`]audit_log["'`]/g;
        if (re.test(src)) offenders.push(f);
        if (/audit_log[^\n]{0,40}\b(PATCH|DELETE)\b/.test(src)) offenders.push(f);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("the UI never offers an audit edit or delete control", () => {
    const view = readFileSync("public/js/views/audit.js", "utf8");
    assert.ok(!/data-action="audit[-_.]?(delete|edit|remove|update)/i.test(view));
    assert.ok(!/<(input|textarea|select)[^>]*data-audit-row/i.test(view));
  });

  it("the owner's list shows entries newest first with before and after values", async () => {
    const r = await call(fresh(), "admin-audit", "owner", { action: "list" });
    const rows = r.json.rows as Record<string, string>[];
    assert.equal(rows[0].actor_email, "system");
    assert.equal(rows[1].old_value, "CONSULTING");
    assert.equal(rows[1].new_value, "OPERATIONS CONSULTING");
  });

  it("filters by action family, actor and date, and exports CSV", async () => {
    const deps = fresh();
    await call(deps, "admin-content", "admin", { action: "save", changes: { "hero.eyebrow": "A" } });
    const byFamily = await call(deps, "admin-audit", "owner", { action: "list", action_prefix: "content" });
    assert.ok((byFamily.json.rows as { action: string }[]).every((x) => x.action.startsWith("content")));
    const byActor = await call(deps, "admin-audit", "owner", { action: "list", actor: "admin@" });
    assert.equal(byActor.json.total, 1);
    const csv = await call(deps, "admin-audit", "owner", { action: "export_csv" });
    assert.match(csv.text, /^id,created_at,actor_email,action,target,old_value,new_value,actor_country/);
  });

  it("every non-settings write leaves an audit row", async () => {
    const cases: [string, Record<string, unknown>, "owner" | "admin"][] = [
      ["admin-content", { action: "save", changes: { "offer.cta": "Book an hour" } }, "admin"],
      ["admin-answers", { action: "save", title: "T", slug: "t-one", summary: "s", body_md: "b", published: false }, "admin"],
      ["admin-availability", { action: "add_override", date: "2026-10-30", kind: "block" }, "admin"],
      ["admin-bookings", { action: "email_link", booking_id: IDS.bookingPaidUnscheduled }, "admin"],
      ["admin-slot-requests", { action: "decline", request_id: IDS.request1 }, "admin"],
      ["admin-team", { action: "set_role", member_id: IDS.team, role: "admin" }, "owner"],
      ["trigger-publish", { action: "publish" }, "admin"],
    ];
    for (const [fn, body, who] of cases) {
      const deps = fresh();
      const r = await call(deps, fn, who, body);
      assert.equal(r.status, 200, `${fn}: ${r.text}`);
      assert.ok(auditInserts(deps) >= 1, `${fn} wrote no audit row`);
    }
  });
});
