// The UI half of the role rules, tested on the pure render functions the SPA uses.
// "Not rendered at all" is checked on the HTML string: what is not in it is not in the DOM.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTROLS, PANES, panesFor } from "../public/js/lib/panes.js";
import { frame, notAuthorised, signIn } from "../public/js/views/shell.js";
import bookings from "../public/js/views/bookings.js";
import audit, { diffWords } from "../public/js/views/audit.js";
import team from "../public/js/views/team.js";
import settings from "../public/js/views/settings.js";
import content, { buildTree, headingPath, humanize, searchHits } from "../public/js/views/content.js";
import answers, { summaryNote } from "../public/js/views/answers.js";
import signals from "../public/js/views/signals.js";
import traffic from "../public/js/views/traffic.js";
import availability from "../public/js/views/availability.js";
import slotRequests from "../public/js/views/slot-requests.js";
import { cached, forget, generation, READS, remember } from "../public/js/lib/cache.js";
import { EXPECTED } from "./matrix.ts";
import { call, fresh } from "./helpers.ts";

type Role = "owner" | "admin" | "team";
const ROLES: Role[] = ["owner", "admin", "team"];
const ctxFor = (role: Role) => ({ role, me: { role, email: `${role}@x` } });

/** Loads a pane's state through the real Edge Function, as that role. */
async function stateFor(view: { load: Function; initial?: Function }, role: Role) {
  const deps = fresh();
  const api = async (fn: string, body: Record<string, unknown>) => {
    const r = await call(deps, fn, role, body);
    if (r.status !== 200) throw new Error(`${fn} ${r.status}`);
    return r.json;
  };
  const initial = view.initial?.() ?? {};
  return { ...initial, ...(await view.load({ role, api }, initial)) };
}

describe("tabs", () => {
  it("each role gets exactly its tabs", () => {
    assert.deepEqual(panesFor("team").map((p: { id: string }) => p.id), ["bookings", "signals", "traffic"]);
    assert.deepEqual(panesFor("admin").map((p: { id: string }) => p.id), ["bookings", "slot-requests", "availability", "content", "answers", "signals", "traffic", "settings"]);
    assert.equal(panesFor("owner").length, PANES.length);
  });

  for (const role of ROLES) {
    it(`the ${role} frame contains no link to a tab it cannot use`, () => {
      const out = String(frame({ role, email: "x@y" }, "bookings"));
      for (const p of PANES) {
        const present = out.includes(`href="#/${p.id}"`);
        assert.equal(present, p.roles.includes(role), `${role} / ${p.id}`);
      }
    });
  }

  it("UI controls agree with the server's role matrix", () => {
    for (const [key, roles] of Object.entries(CONTROLS)) {
      if (key === "admin-bookings.revenue") continue;
      const [fn, action] = key.split(".");
      assert.ok(EXPECTED[fn]?.[action], `${key} has no server action`);
      assert.deepEqual([...(roles as string[])].sort(), [...EXPECTED[fn][action]].sort(), key);
    }
  });
});

describe("bookings pane", () => {
  it("team: no revenue, no amount column, no email-link, no CSV — nothing to hide, nothing rendered", async () => {
    const out = String(bookings.render(await stateFor(bookings, "team"), ctxFor("team")));
    assert.ok(!/Revenue/i.test(out));
    assert.ok(!out.includes("<th>Amount</th>"));
    assert.ok(!out.includes('data-click="email-link"'));
    assert.ok(!out.includes('data-click="csv"'));
    assert.ok(!/98765|87654/.test(out));
    assert.ok(out.includes("Paid but not scheduled"));
  });

  it("admin: email-link yes, revenue and CSV no", async () => {
    const out = String(bookings.render(await stateFor(bookings, "admin"), ctxFor("admin")));
    assert.ok(out.includes('data-click="email-link"'));
    assert.ok(!/Revenue/i.test(out));
    assert.ok(!out.includes('data-click="csv"'));
  });

  it("owner: revenue card, amount column and CSV", async () => {
    const out = String(bookings.render(await stateFor(bookings, "owner"), ctxFor("owner")));
    assert.ok(out.includes("Revenue this month"));
    assert.ok(out.includes("<th>Amount</th>"));
    assert.ok(out.includes('data-click="csv"'));
  });

  it("even if revenue were somehow present in the data, a non-owner render drops it", async () => {
    const s = await stateFor(bookings, "owner");
    const out = String(bookings.render(s, ctxFor("admin")));
    assert.ok(!/Revenue/i.test(out) && !out.includes("<th>Amount</th>"));
  });

  it("escapes user-supplied text", async () => {
    const s = await stateFor(bookings, "owner");
    s.rows[0].payer_name = '<img src=x onerror="alert(1)">';
    const out = String(bookings.render(s, ctxFor("owner")));
    assert.ok(!out.includes("<img src=x"));
    assert.ok(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  });
});

describe("audit pane", () => {
  it("renders no edit or delete control and no editable field on any row", async () => {
    const out = String(audit.render(await stateFor(audit, "owner"), ctxFor("owner")));
    const tbody = out.slice(out.indexOf("<tbody>"));
    assert.ok(!/<(button|input|textarea|select)\b/.test(tbody), "no controls inside audit rows");
    assert.ok(!/delete|remove|edit/i.test(out.replace(/cannot be edited or removed/, "")));
  });

  it("diffs word by word", () => {
    const d = diffWords("Book your hour", "Book an hour");
    assert.deepEqual(d.old.filter(([, c]: [string, boolean]) => c).map(([t]: [string]) => t), ["your"]);
    assert.deepEqual(d.new.filter(([, c]: [string, boolean]) => c).map(([t]: [string]) => t), ["an"]);
  });
});

describe("team pane", () => {
  it("the owner's own row has no controls, and a sole owner is marked as the last owner", async () => {
    const s = await stateFor(team, "owner");
    const out = String(team.render(s, ctxFor("owner")));
    const own = out.split("<tr>").find((r) => r.includes("owner@avidproblemsolvers.com"))!;
    assert.ok(!/<select|<button/.test(own));
    assert.ok(own.includes("last owner"));
    assert.ok(!/delete/i.test(out.replace(/never deleted/, "")), "no delete control exists");
  });
});

describe("settings pane", () => {
  it("shows the active mode and validates per key", async () => {
    const s = await stateFor(settings, "admin");
    const out = String(settings.render(s, ctxFor("admin")));
    assert.ok(out.includes(">TEST<"));
    assert.ok(out.includes('name="razorpay_payment_url_live"'));
    assert.ok(out.includes('name="scheduler_buffer_minutes"'));
    const bad = String(settings.render({ ...s, errors: { razorpay_payment_url_live: "Must be a Razorpay payment page URL" } }, ctxFor("admin")));
    assert.ok(bad.includes("Must be a Razorpay payment page URL"));
  });
});

describe("pane cache", () => {
  it("returns copies, and a load that started before a write is discarded", () => {
    forget();
    remember("x", { rows: [1] }, generation());
    const a = cached("x");
    a.data.rows.push(2);
    assert.deepEqual(cached("x").data.rows, [1]);
    const since = generation();
    forget();
    remember("x", { rows: ["stale"] }, since);
    assert.equal(cached("x"), undefined);
  });

  it("treats every write action as a write", () => {
    const writes = Object.keys(CONTROLS).map((c) => c.split(".")[1]).filter((a) => a !== "revenue" && a !== "export_csv");
    for (const a of writes) assert.ok(!READS.has(a), `${a} must clear the cache`);
  });
});

describe("content pane", () => {
  const row = (key: string, value = "x") => ({ key, value, updated_at: "2026-01-01T00:00:00Z" });
  const rows = ["answers_index.categories.buying.lead", "answers_index.title", "answers_index.categories.buying", "a.b.c.d.e.f", "solo"].map((k) => row(k));

  it("derives labels from segments", () => {
    assert.equal(humanize("answers_index"), "Answers Index");
    assert.equal(humanize("EMPTY_STATE"), "Empty State");
    assert.equal(humanize("h1"), "H1");
  });

  it("nests one level per dot, to any depth, own fields before groups", () => {
    const tree = buildTree(rows);
    assert.deepEqual(tree.map((t: { name: string }) => t.name), ["a", "answers_index", "solo"]);
    const ai = tree[1];
    assert.deepEqual(ai.fields.map((r: { key: string }) => r.key), ["answers_index.title"]);
    const cats = ai.groups[0];
    assert.equal(cats.label, "Categories");
    assert.deepEqual(cats.fields.map((r: { key: string }) => r.key), ["answers_index.categories.buying"]);
    assert.deepEqual(cats.groups[0].fields.map((r: { key: string }) => r.key), ["answers_index.categories.buying.lead"]);
    let n = tree[0], depth = 0;
    while (n.groups.length) (n = n.groups[0]), depth++;
    assert.equal(depth, 4);
    assert.deepEqual(n.fields.map((r: { key: string }) => r.key), ["a.b.c.d.e.f"]);
    assert.deepEqual(tree[2].fields.map((r: { key: string }) => r.key), ["solo"]);
  });

  it("search matches key or current value across sections and reports the heading path", () => {
    const state = { rows: [row("x.one", "needle"), row("y.needle_key"), row("z.no")], edits: { "z.no": "edited needle" }, q: "NEEDLE" };
    assert.deepEqual(searchHits(state).map((r: { key: string }) => r.key), ["x.one", "y.needle_key", "z.no"]);
    assert.deepEqual(headingPath("answers_index.categories.buying.lead"), ["Answers Index", "Categories", "Buying"]);
    assert.deepEqual(headingPath("solo"), ["Solo"]);
  });

  it("renders the chosen tab from the hash and keeps the publish notice", () => {
    const ctx = { ...ctxFor("admin"), sub: "solo" };
    const out = String(content.render({ ...content.initial(ctx), rows }, ctx));
    assert.match(out, /href="#\/content\/solo" data-tab="solo" data-click="section" aria-current="page"/);
    assert.ok(out.includes("Saved edits are not live until you publish."));
  });
});

describe("other panes render for every role that can open them", () => {
  const views: [string, { load: Function; render: Function; initial?: Function }][] = [
    ["slot-requests", slotRequests], ["availability", availability], ["content", content], ["answers", answers],
    ["signals", signals], ["traffic", traffic], ["settings", settings], ["team", team], ["audit", audit], ["bookings", bookings],
  ];
  for (const [id, view] of views) {
    for (const role of ROLES) {
      if (!PANES.find((p: { id: string }) => p.id === id).roles.includes(role)) continue;
      it(`${id} as ${role}`, async () => {
        const out = String(view.render(await stateFor(view, role), ctxFor(role)));
        assert.ok(out.length > 200);
        assert.ok(!/\bstyle="/.test(out), "inline styles would be blocked by the CSP");
        assert.ok(!out.includes("undefined"), "no undefined leaks into the page");
      });
    }
  }

  it("signals never shows a session id", async () => {
    const out = String(signals.render(await stateFor(signals, "team"), ctxFor("team")));
    assert.ok(!out.includes("sess-"));
  });

  it("answers warns outside 40–60 words", () => {
    assert.match(String(summaryNote(12)), /warn/);
    assert.doesNotMatch(String(summaryNote(50)), /warn/);
  });
});

describe("sign-in", () => {
  it("has no sign-up path and no password field", () => {
    const out = String(signIn());
    assert.ok(!/sign.?up|register|password|create account/i.test(out));
    assert.ok(!out.includes('type="password"'));
  });

  it("the not-authorised screen is one fixed screen with no detail", () => {
    assert.equal(String(notAuthorised()), String(notAuthorised()));
    assert.ok(!/exist|unknown|inactive|deactivated/i.test(String(notAuthorised())));
  });

  it("sendLink posts create_user:false and returns the same message whatever the server says", async () => {
    const g = globalThis as Record<string, unknown>;
    g.window = { location: { origin: "https://admin.avidproblemsolvers.com" } };
    const bodies: unknown[] = [];
    const replies = [new Response("{}", { status: 200 }), new Response('{"msg":"Signups not allowed for otp"}', { status: 422 })];
    g.fetch = async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return replies.shift();
    };
    const { sendLink, NEUTRAL_SENT } = await import("../public/js/lib/auth.js");
    assert.equal(await sendLink("Known@AvidProblemSolvers.com"), NEUTRAL_SENT);
    assert.equal(await sendLink("nobody@avidproblemsolvers.com"), NEUTRAL_SENT);
    assert.deepEqual(bodies, [
      { email: "known@avidproblemsolvers.com", create_user: false },
      { email: "nobody@avidproblemsolvers.com", create_user: false },
    ]);
  });

  it("refuses an off-domain address without contacting the auth service (a courtesy; the server is the gate)", async () => {
    const g = globalThis as Record<string, unknown>;
    g.window = { location: { origin: "https://admin.avidproblemsolvers.com" } };
    let calls = 0;
    g.fetch = async () => {
      calls++;
      return new Response("{}");
    };
    const { sendLink, WRONG_DOMAIN } = await import("../public/js/lib/auth.js");
    for (const e of ["boss@example.com", "boss@evil.avidproblemsolvers.com", "boss@avidproblemsolvers.com.evil.io"]) {
      assert.equal(await sendLink(e), WRONG_DOMAIN, e);
    }
    assert.equal(calls, 0);
    assert.match(WRONG_DOMAIN, /@avidproblemsolvers\.com/);
    assert.match(String(signIn()), /placeholder="you@avidproblemsolvers\.com"/);
  });

  it("offers a code, not a link, and shows the code field only once a code was requested", () => {
    const before = String(signIn());
    assert.match(before, /Email me a sign-in code/);
    assert.ok(!before.includes("verify-code"));
    const after = String(signIn({ message: "x", codeFor: "a@avidproblemsolvers.com" }));
    const field = /<input[^>]*name="code"[^>]*>/.exec(after)?.[0] ?? "";
    for (const attr of ['inputmode="numeric"', 'autocomplete="one-time-code"', 'maxlength="6"', 'pattern="[0-9]{6}"']) assert.ok(field.includes(attr), attr);
    assert.match(after, /name="email" value="a@avidproblemsolvers\.com"/);
    assert.ok(!String(signIn({ codeFor: '"><script>' })).includes("<script>"), "address is escaped");
  });

  it("verifyCode posts type email to /verify and establishes the session", async () => {
    const g = globalThis as Record<string, unknown>;
    g.window = { location: { origin: "https://admin.avidproblemsolvers.com" } };
    const calls: { url: string; body: unknown }[] = [];
    g.fetch = async (u: string, init: RequestInit) => {
      calls.push({ url: u, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 });
    };
    const { verifyCode, hasSession, accessToken, signOut } = await import("../public/js/lib/auth.js");
    assert.equal(await verifyCode("Known@AvidProblemSolvers.com", " 123 456 "), null);
    assert.match(calls[0].url, /\/auth\/v1\/verify$/);
    assert.deepEqual(calls[0].body, { type: "email", email: "known@avidproblemsolvers.com", token: "123456" });
    assert.ok(hasSession());
    assert.equal(await accessToken(), "at");
    g.fetch = async () => new Response("", { status: 204 });
    await signOut();
  });

  it("a wrong, expired or unknown-address code gets one plain message", async () => {
    const g = globalThis as Record<string, unknown>;
    g.window = { location: { origin: "https://admin.avidproblemsolvers.com" } };
    const replies = [
      new Response('{"error_code":"otp_expired","msg":"Token has expired or is invalid"}', { status: 403 }),
      new Response('{"error_code":"otp_expired","msg":"Token has expired or is invalid"}', { status: 400 }),
      new Response('{"msg":"User not found"}', { status: 404 }),
      new Response("not json", { status: 200 }),
    ];
    g.fetch = async () => replies.shift();
    const { verifyCode, hasSession, BAD_CODE } = await import("../public/js/lib/auth.js");
    for (let i = 0; i < 4; i++) assert.equal(await verifyCode("nobody@avidproblemsolvers.com", "000000"), BAD_CODE);
    assert.ok(!hasSession());
    assert.ok(!/exist|unknown|account|authoris/i.test(BAD_CODE));
  });

  it("verifyCode refuses an off-domain address or a malformed code without contacting the auth service", async () => {
    const g = globalThis as Record<string, unknown>;
    g.window = { location: { origin: "https://admin.avidproblemsolvers.com" } };
    let calls = 0;
    g.fetch = async () => {
      calls++;
      return new Response("{}");
    };
    const { verifyCode, WRONG_DOMAIN } = await import("../public/js/lib/auth.js");
    assert.equal(await verifyCode("boss@example.com", "123456"), WRONG_DOMAIN);
    for (const c of ["12345", "1234567", "abcdef", ""]) assert.match(String(await verifyCode("a@avidproblemsolvers.com", c)), /six-digit/);
    assert.equal(calls, 0);
  });
});
