// Settings pane: site_settings, validated per key, updated_by set, and NO audit row written
// by the function (the database trigger does it).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateChanges, validateSetting } from "../supabase/functions/_shared/settings_schema.js";
import { auditInserts, call, fresh, IDS } from "./helpers.ts";

describe("settings validation", () => {
  const cases: [string, string, boolean][] = [
    ["razorpay_mode", "live", true],
    ["razorpay_mode", "LIVE", false],
    ["razorpay_mode", "prod", false],
    ["razorpay_payment_url_test", "", true],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/NEKINBI", true],
    ["razorpay_payment_url_live", "  https://rzp.io/rzp/NEKINBI  ", true],
    ["razorpay_payment_url_live", "https://rzp.io/l/aB3_x-y.z~1", true],
    ["razorpay_payment_url_live", "https://pages.razorpay.com/pl_AbCdEfGhIjKlMn/view", true],
    ["razorpay_payment_url_live", "https://a.b.razorpay.com/x", true],
    ["razorpay_payment_url_live", "http://rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "//rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://rzp.io", false],
    ["razorpay_payment_url_live", "https://rzp.io/", false],
    ["razorpay_payment_url_live", "https://rzp.io:443/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://user@rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://user:pw@rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://evil.com@rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://rzp.io@evil.com/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://rzp.io.evil.com/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://evil-rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://evilrzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://www.rzp.io/rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://rzp.io./rzp/NEKINBI", false],
    ["razorpay_payment_url_live", "https://razorpay.com/x", false],
    ["razorpay_payment_url_live", "https://evilrazorpay.com/x", false],
    ["razorpay_payment_url_live", "https://pages.razorpay.com.evil.com/x", false],
    ["razorpay_payment_url_live", "https://pages-razorpay.com/x", false],
    ["razorpay_payment_url_live", "https://-x.razorpay.com/x", false],
    ["razorpay_payment_url_live", "https://rzp.io\\@evil.com/x", false],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/NEKINBI?next=https://evil.com", false],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/NEKINBI#x", false],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/NEK INBI", false],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/<script>", false],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/%3Cx%3E", false],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/\"onmouseover=x", false],
    ["razorpay_payment_url_live", "javascript:alert(1)//rzp.io/x", false],
    ["razorpay_payment_url_live", "https://rzp.io/rzp/NEKINBI\nhttps://evil.com/", false],
    ["razorpay_payment_url_live", "https://rzp.io/" + "a".repeat(485), true],
    ["razorpay_payment_url_live", "https://rzp.io/" + "a".repeat(486), false],
    ["razorpay_button_id_live", "pl_AbCdEfGhIjKlMn", false],
    ["razorpay_button_id_test", "", false],
    ["scheduler_timezone", "Asia/Kolkata", true],
    ["scheduler_timezone", "Mars/Olympus", false],
    ["scheduler_timezone", "", false],
    ["scheduler_slot_minutes", "60", true],
    ["scheduler_slot_minutes", "50", false],
    ["scheduler_slot_minutes", "0", false],
    ["scheduler_buffer_minutes", "15", true],
    ["scheduler_buffer_minutes", "-5", false],
    ["scheduler_min_notice_hours", "24", true],
    ["scheduler_min_notice_hours", "1.5", false],
    ["scheduler_window_days", "30", true],
    ["scheduler_window_days", "365", false],
    ["no_such_key", "x", false],
  ];
  for (const [key, value, ok] of cases) {
    it(`${key} = ${JSON.stringify(value)} → ${ok ? "valid" : "invalid"}`, () => {
      assert.equal(validateSetting(key, value).ok, ok);
    });
  }

  it("cannot switch to Live without a Live payment page URL", () => {
    const r = validateChanges({ razorpay_mode: "test", razorpay_payment_url_test: "https://rzp.io/rzp/TESTPAGE1" }, { razorpay_mode: "live" });
    assert.equal(r.ok, false);
    assert.match(r.errors.razorpay_mode, /Live-mode payment page URL/);
  });

  it("cannot blank the active payment page URL", () => {
    const r = validateChanges({ razorpay_mode: "test", razorpay_payment_url_test: "https://rzp.io/rzp/TESTPAGE1" }, { razorpay_payment_url_test: "" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.razorpay_payment_url_test);
  });

  it("stores the trimmed URL", () => {
    assert.equal(validateSetting("razorpay_payment_url_live", " https://rzp.io/rzp/NEKINBI ").value, "https://rzp.io/rzp/NEKINBI");
  });
});

describe("settings function", () => {
  it("switches Test → Live in one save, sets updated_by, and writes no audit row itself", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-settings", "admin", {
      action: "save",
      changes: { razorpay_payment_url_live: "https://rzp.io/rzp/LIVEPAGE1", razorpay_mode: "live" },
    });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((r.json.updated as string[]).sort(), ["razorpay_mode", "razorpay_payment_url_live"]);
    const rows = deps.mem.tables.site_settings;
    assert.equal(rows.find((x) => x.key === "razorpay_mode")!.value, "live");
    for (const k of ["razorpay_mode", "razorpay_payment_url_live"]) {
      assert.equal(rows.find((x) => x.key === k)!.updated_by, IDS.admin, `${k} updated_by`);
    }
    assert.equal(auditInserts(deps), 0, "the function must not insert into audit_log");
    // The emulated trigger attributes both changes to the admin, not "system".
    const trig = deps.mem.tables.audit_log.filter((a) => a.action === "site_settings.update");
    assert.equal(trig.length, 2);
    assert.ok(trig.every((a) => a.actor_email === "admin@avidproblemsolvers.com"));
  });

  it("rejects an invalid value per key, writing nothing", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-settings", "owner", {
      action: "save",
      changes: { scheduler_buffer_minutes: "7", razorpay_payment_url_test: "nope" },
    });
    assert.equal(r.status, 400);
    const errors = r.json.errors as Record<string, string>;
    assert.ok(errors.scheduler_buffer_minutes && errors.razorpay_payment_url_test);
    assert.equal(deps.mem.log.filter((l) => l.table === "site_settings").length, 0);
  });

  it("rejects unknown keys", async () => {
    const r = await call(fresh(), "admin-settings", "owner", { action: "save", changes: { owner_email: "x@y.z" } });
    assert.equal(r.status, 400);
  });

  it("returns defaults for keys not yet stored, and who last changed each stored key", async () => {
    const r = await call(fresh(), "admin-settings", "admin", { action: "get" });
    const values = r.json.values as Record<string, string>;
    assert.equal(values.scheduler_slot_minutes, "60");
    assert.equal(values.razorpay_mode, "test");
    assert.equal((r.json.meta as Record<string, { updated_by: string }>).razorpay_mode.updated_by, "owner@avidproblemsolvers.com");
  });

  it("scheduler settings feed the availability preview", async () => {
    const deps = fresh();
    const before = (await call(deps, "admin-availability", "admin", { action: "get" })).json.preview as { slots: string[] };
    await call(deps, "admin-settings", "admin", { action: "save", changes: { scheduler_window_days: "7" } });
    const after = (await call(deps, "admin-availability", "admin", { action: "get" })).json.preview as { slots: string[] };
    assert.ok(after.slots.length < before.slots.length);
  });

  it("team cannot read or write settings", async () => {
    const deps = fresh();
    assert.equal((await call(deps, "admin-settings", "team", { action: "get" })).status, 403);
    assert.equal((await call(deps, "admin-settings", "team", { action: "save", changes: { razorpay_mode: "live" } })).status, 403);
  });
});
