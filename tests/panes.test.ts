// Behaviour of each pane's Edge Function against the in-memory database.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateSlots, schedulerSettings, zonedToUtc } from "../supabase/functions/_shared/slots.ts";
import { auditInserts, call, fresh, IDS, NOW } from "./helpers.ts";

type R = Record<string, unknown>;

describe("bookings", () => {
  it("pins rows unscheduled for over 24h to the top and flags them", async () => {
    const r = await call(fresh(), "admin-bookings", "team", { action: "list" });
    const rows = r.json.rows as R[];
    assert.equal(rows[0].id, IDS.bookingPaidUnscheduled);
    assert.equal(rows[0].flagged, true);
    assert.equal(rows.find((x) => x.id === IDS.bookingFresh)!.flagged, false, "2h old is not yet flagged");
    // the rest newest first
    const rest = rows.slice(1).map((x) => Date.parse(String(x.created_at)));
    assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
  });

  it("computes the stat cards", async () => {
    const r = await call(fresh(), "admin-bookings", "admin", { action: "list" });
    assert.deepEqual(r.json.stats, { total: 5, upcoming: 1, paid_not_scheduled: 2, brief_missing: 3 });
  });

  it("shows the client's timezone when they asked for alternate times", async () => {
    const r = await call(fresh(), "admin-bookings", "team", { action: "list" });
    const row = (r.json.rows as R[]).find((x) => x.id === IDS.bookingPaidUnscheduled)!;
    assert.equal(row.client_timezone, "America/New_York");
    assert.equal(row.pending_request, true);
  });

  it("detail returns the brief, signed file links and linked probe text", async () => {
    const r = await call(fresh(), "admin-bookings", "team", { action: "detail", booking_id: IDS.bookingUpcoming });
    assert.equal((r.json.brief as R).what_fixed_looks_like, "Five days, predictably.");
    assert.equal((r.json.files as R[])[0].name, "close-calendar.xlsx");
    assert.match(String((r.json.files as R[])[0].url), /^https:\/\/storage\.example\/briefs\//);
    assert.match(String((r.json.probes as R[])[0].problem_text), /month-end close/i);
  });

  it("'Email booking link' mails the /confirmed link, stamps reminder_sent_at and audits", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-bookings", "admin", { action: "email_link", booking_id: IDS.bookingPaidUnscheduled });
    assert.equal(r.status, 200);
    assert.equal(deps.fakeMail.sent[0].to, "priya@example.com");
    assert.match(deps.fakeMail.sent[0].text, /avidproblemsolvers\.com\/confirmed\?razorpay_payment_id=pay_MOCK0001/);
    assert.ok(deps.mem.tables.bookings.find((b) => b.id === IDS.bookingPaidUnscheduled)!.reminder_sent_at);
    assert.equal(deps.mem.tables.audit_log.at(-1)!.action, "booking.email_link");
  });

  it("refuses to send a booking link for an already-scheduled booking", async () => {
    const r = await call(fresh(), "admin-bookings", "owner", { action: "email_link", booking_id: IDS.bookingUpcoming });
    assert.equal(r.status, 409);
  });

  it("validates ids", async () => {
    assert.equal((await call(fresh(), "admin-bookings", "owner", { action: "detail", booking_id: "1 or 1=1" })).status, 400);
  });
});

describe("slot generation", () => {
  const base = { rules: [{ weekday: 4, start_time: "10:00", end_time: "13:00", timezone: "Asia/Kolkata", active: true }], overrides: [], booked: [] };
  const s = schedulerSettings({});

  it("converts IST wall-clock to UTC", () => {
    assert.equal(new Date(zonedToUtc("2026-10-22", "10:00", "Asia/Kolkata")).toISOString(), "2026-10-22T04:30:00.000Z");
    assert.equal(new Date(zonedToUtc("2026-03-08", "10:00", "America/New_York")).toISOString(), "2026-03-08T14:00:00.000Z");
  });

  it("steps by session + buffer and respects the window end", () => {
    const slots = generateSlots({ ...base, settings: s, now: NOW }).filter((x) => x.startsWith("2026-10-22"));
    // 10:00, 11:15 IST fit; 12:30 would end 13:30, past 13:00.
    assert.deepEqual(slots, ["2026-10-22T04:30:00.000Z", "2026-10-22T05:45:00.000Z"]);
  });

  it("enforces minimum notice", () => {
    const slots = generateSlots({ ...base, settings: { ...s, minNoticeHours: 72 }, now: NOW });
    assert.ok(slots.every((x) => Date.parse(x) >= NOW.getTime() + 72 * 3_600_000));
    assert.ok(!slots.some((x) => x.startsWith("2026-10-22")));
  });

  it("subtracts booked slots with buffer on both sides", () => {
    const booked = [{ slot_start: "2026-10-22T04:30:00Z", slot_end: "2026-10-22T05:30:00Z", status: "captured" }];
    const slots = generateSlots({ ...base, booked, settings: s, now: NOW }).filter((x) => x.startsWith("2026-10-22"));
    assert.deepEqual(slots, ["2026-10-22T05:45:00.000Z"]);
  });

  it("applies whole-day blocks and extra windows", () => {
    const overrides = [
      { date: "2026-10-22", kind: "block", start_time: null, end_time: null },
      { date: "2026-10-24", kind: "extra", start_time: "09:00", end_time: "10:00" },
    ];
    const slots = generateSlots({ ...base, overrides, settings: s, now: NOW });
    assert.ok(!slots.some((x) => x.startsWith("2026-10-22")));
    assert.ok(slots.includes("2026-10-24T03:30:00.000Z"));
  });

  it("the availability pane previews the next window as a visitor would see it", async () => {
    const r = await call(fresh(), "admin-availability", "admin", { action: "get" });
    const slots = (r.json.preview as { slots: string[] }).slots;
    assert.ok(slots.length > 50);
    assert.ok(Date.parse(slots[0]) >= NOW.getTime() + 24 * 3_600_000);
    // The upcoming booking is Fri 23 Oct 12:00–13:00 IST: 11:15 and 12:30 collide with it (+15 min buffer).
    assert.ok(slots.includes("2026-10-23T04:30:00.000Z"), "10:00 IST still offered");
    assert.ok(!slots.includes("2026-10-23T05:45:00.000Z"), "11:15 IST blocked");
    assert.ok(!slots.includes("2026-10-23T07:00:00.000Z"), "12:30 IST blocked");
  });
});

describe("availability writes", () => {
  it("saves the weekly grid, rejecting overlaps and bad times", async () => {
    const deps = fresh();
    const bad = await call(deps, "admin-availability", "admin", {
      action: "save_rules",
      rules: [{ weekday: 1, start_time: "10:00", end_time: "12:00" }, { weekday: 1, start_time: "11:00", end_time: "13:00" }],
    });
    assert.equal(bad.status, 400);
    const backwards = await call(deps, "admin-availability", "admin", { action: "save_rules", rules: [{ weekday: 1, start_time: "12:00", end_time: "10:00" }] });
    assert.equal(backwards.status, 400);
    const ok = await call(deps, "admin-availability", "admin", {
      action: "save_rules",
      rules: [{ weekday: 6, start_time: "09:00", end_time: "11:00", timezone: "Asia/Kolkata" }],
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(deps.mem.tables.availability_rules.length, 1);
    assert.equal(deps.mem.tables.audit_log.at(-1)!.action, "availability.rules");
  });

  it("adds and removes overrides", async () => {
    const deps = fresh();
    const add = await call(deps, "admin-availability", "owner", { action: "add_override", date: "2026-10-29", kind: "block", note: "Diwali" });
    assert.equal(add.status, 200);
    const id = (add.json.saved as R).id;
    assert.equal((await call(deps, "admin-availability", "owner", { action: "add_override", date: "2026-10-29", kind: "extra" })).status, 400);
    const rm = await call(deps, "admin-availability", "owner", { action: "remove_override", override_id: id });
    assert.equal(rm.status, 200);
    assert.equal(deps.mem.tables.slot_overrides.length, 0);
  });
});

describe("slot requests", () => {
  it("approve sets the booking, calls create-meeting, sends both emails, audits", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-slot-requests", "admin", { action: "approve", request_id: IDS.request1, choice: 2 });
    assert.equal(r.status, 200, r.text);
    const b = deps.mem.tables.bookings.find((x) => x.id === IDS.bookingPaidUnscheduled)!;
    assert.equal(b.scheduled, true);
    assert.equal(b.slot_start, new Date(NOW.getTime() + 120 * 3_600_000).toISOString());
    assert.equal(Date.parse(String(b.slot_end)) - Date.parse(String(b.slot_start)), 3_600_000);
    assert.deepEqual(deps.fakeMeetings.created, [IDS.bookingPaidUnscheduled]);
    assert.deepEqual(deps.fakeMail.sent.map((m) => m.to).sort(), ["owner@avidproblemsolvers.com", "priya@example.com"]);
    assert.match(deps.fakeMail.sent.find((m) => m.to === "priya@example.com")!.text, /EDT|EST|GMT-4|GMT-5/);
    assert.match(deps.fakeMail.sent.find((m) => m.to === "priya@example.com")!.text, /IST|GMT\+5:30/);
    assert.equal(deps.mem.tables.slot_requests[0].status, "approved");
    assert.equal(deps.mem.tables.audit_log.at(-1)!.action, "slot_request.approve");
  });

  it("cannot approve twice", async () => {
    const deps = fresh();
    await call(deps, "admin-slot-requests", "admin", { action: "approve", request_id: IDS.request1, choice: 1 });
    const again = await call(deps, "admin-slot-requests", "owner", { action: "approve", request_id: IDS.request1, choice: 2 });
    assert.equal(again.status, 409);
  });

  it("a slot already taken by another booking fails cleanly and leaves the request pending", async () => {
    const deps = fresh();
    const req = deps.mem.tables.slot_requests[0];
    deps.mem.tables.bookings.find((b) => b.id === IDS.bookingUpcoming)!.slot_start = req.preferred_1;
    const r = await call(deps, "admin-slot-requests", "admin", { action: "approve", request_id: IDS.request1, choice: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "slot_taken");
    assert.equal(deps.mem.tables.slot_requests[0].status, "pending");
    assert.equal(deps.mem.tables.bookings.find((b) => b.id === IDS.bookingPaidUnscheduled)!.scheduled, false);
  });

  it("decline emails the standard slot list in their timezone and audits", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-slot-requests", "admin", { action: "decline", request_id: IDS.request1, note: "Travelling that week." });
    assert.equal(r.status, 200);
    const mail = deps.fakeMail.sent[0];
    assert.equal(mail.to, "priya@example.com");
    assert.match(mail.text, /Travelling that week/);
    assert.match(mail.text, /•/);
    assert.match(mail.text, /\/confirmed\?razorpay_payment_id=/);
    assert.equal(deps.mem.tables.audit_log.at(-1)!.action, "slot_request.decline");
  });
});

describe("content", () => {
  it("writes one audit row per changed field with old and new values, skipping unchanged", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-content", "admin", {
      action: "save",
      changes: { "hero.eyebrow": "NEW EYEBROW", "offer.cta": "Book your hour", "offer.price": "$1,299" },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.updated, ["hero.eyebrow", "offer.price"]);
    assert.equal(auditInserts(deps), 2);
    const rows = deps.mem.tables.audit_log.slice(-2);
    assert.deepEqual(rows.map((x) => [x.target, x.old_value, x.new_value]), [
      ["hero.eyebrow", "OPERATIONS CONSULTING", "NEW EYEBROW"],
      ["offer.price", "$1,199", "$1,299"],
    ]);
  });

  it("refuses unknown keys and empty copy, writing nothing", async () => {
    const deps = fresh();
    assert.equal((await call(deps, "admin-content", "admin", { action: "save", changes: { "new.key": "x" } })).status, 400);
    assert.equal((await call(deps, "admin-content", "admin", { action: "save", changes: { "hero.h1": "  ", "offer.cta": "x" } })).status, 400);
    assert.equal(auditInserts(deps), 0);
    assert.equal(deps.mem.tables.site_content.find((c) => c.key === "offer.cta")!.value, "Book your hour");
  });

  it("publish dispatches to GitHub, returns the run, and status advances", async () => {
    const deps = fresh();
    const p = await call(deps, "trigger-publish", "admin", { action: "publish" });
    assert.equal(p.status, 200);
    assert.equal(deps.fakeGitHub.dispatches[0].eventType, "publish");
    const run = p.json.run as { id: number };
    assert.ok(run.id);
    const s1 = await call(deps, "trigger-publish", "admin", { action: "status", run_id: run.id });
    assert.equal((s1.json.run as R).status, "in_progress");
    const s2 = await call(deps, "trigger-publish", "admin", { action: "status", run_id: run.id });
    assert.equal((s2.json.run as R).conclusion, "success");
  });
});

describe("answers", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("warns when the summary is outside 40–60 words but still saves", async () => {
    const deps = fresh();
    const r = await call(deps, "admin-answers", "admin", { action: "save", title: "T", slug: "short-one", summary: words(12), body_md: "b" });
    assert.equal(r.status, 200);
    assert.match(String((r.json.warnings as string[])[0]), /12 words/);
    const ok = await call(deps, "admin-answers", "admin", { action: "save", title: "T", slug: "right-one", summary: words(50), body_md: "b" });
    assert.deepEqual(ok.json.warnings, []);
  });

  it("publishing an answer triggers a rebuild; a draft does not", async () => {
    const deps = fresh();
    await call(deps, "admin-answers", "admin", { action: "save", title: "T", slug: "draft-one", summary: words(45), body_md: "b" });
    assert.equal(deps.fakeGitHub.dispatches.length, 0);
    const r = await call(deps, "admin-answers", "admin", { action: "save", title: "T", slug: "live-one", summary: words(45), body_md: "b", published: true });
    assert.ok(r.json.publish);
    assert.equal(deps.fakeGitHub.dispatches.length, 1);
  });

  it("unpublishing a live answer also rebuilds", async () => {
    const deps = fresh();
    const a = deps.mem.tables.answers[0];
    const r = await call(deps, "admin-answers", "owner", { action: "save", id: a.id, title: a.title, slug: a.slug, summary: a.summary, body_md: a.body_md, published: false });
    assert.equal(r.status, 200);
    assert.equal(deps.fakeGitHub.dispatches.length, 1);
  });

  it("rejects bad slugs and duplicate slugs", async () => {
    const deps = fresh();
    assert.equal((await call(deps, "admin-answers", "admin", { action: "save", title: "T", slug: "Bad Slug", summary: "s", body_md: "b" })).status, 400);
    const dup = await call(deps, "admin-answers", "admin", { action: "save", title: "T", slug: "what-is-operations-consulting", summary: "s", body_md: "b" });
    assert.equal(dup.status, 409);
  });
});

describe("signals and traffic", () => {
  it("signals never expose session ids and filter by converted, verdict, country and text", async () => {
    const deps = fresh();
    const all = await call(deps, "admin-signals", "team", { action: "list" });
    assert.ok(!all.text.includes("session_id") && !all.text.includes("sess-"));
    assert.equal(all.json.total, 5);
    assert.equal((await call(deps, "admin-signals", "team", { action: "list", converted: true })).json.total, 2);
    assert.equal((await call(deps, "admin-signals", "team", { action: "list", verdict: "not_fit" })).json.total, 1);
    assert.equal((await call(deps, "admin-signals", "team", { action: "list", country: "in" })).json.total, 2);
    assert.equal((await call(deps, "admin-signals", "team", { action: "list", q: "WAREHOUSE" })).json.total, 1);
  });

  it("traffic aggregates only, with AI referrers and a zero-filled daily series", async () => {
    const r = await call(fresh(), "admin-traffic", "team", { action: "summary", days: 7 });
    assert.equal(r.status, 200);
    assert.equal((r.json.daily as R[]).length, 7);
    assert.deepEqual((r.json.ai as R[]).map((x) => x.label), ["Claude", "ChatGPT", "Perplexity"]);
    assert.ok(!r.text.includes("pv-"), "no session ids");
    assert.equal((await call(fresh(), "admin-traffic", "team", { action: "summary", days: 365 })).status, 400);
  });
});
