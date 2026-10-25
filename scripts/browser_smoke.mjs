// End-to-end smoke test in a real browser, fully offline: starts the mock, drives local
// headless Chrome over the DevTools protocol, clicks through every write flow as the owner,
// then checks what a team member can and cannot see.
//
//   node scripts/browser_smoke.mjs        (needs Google Chrome installed locally)

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 8021;
const ORIGIN = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ID = { owner: "00000000-0000-4000-8000-000000000001", team: "00000000-0000-4000-8000-000000000004", outsider: "00000000-0000-4000-8000-000000000097" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = spawn(process.execPath, ["scripts/mock_functions.mjs", "--port", String(PORT)], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok) => mock.stdout.on("data", (d) => String(d).includes("mock on") && ok()));

const profile = mkdtempSync(join(tmpdir(), "aps-smoke-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "--window-size=1300,900", "about:blank"], { stdio: "ignore" });

let ws, seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
      const page = targets.find((t) => t.type === "page") ??
        await (await fetch("http://127.0.0.1:9333/json/new?about:blank", { method: "PUT" })).json();
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok) => ws.addEventListener("open", ok));
        ws.addEventListener("message", (e) => {
          const m = JSON.parse(e.data);
          if (m.id && pending.has(m.id)) pending.get(m.id)(m);
        });
        return;
      }
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}
const send = (method, params = {}) => new Promise((ok) => {
  const id = ++seq;
  pending.set(id, ok);
  ws.send(JSON.stringify({ id, method, params }));
});
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed");
  return r.result?.result?.value;
}
async function until(expr, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(`return Boolean(${expr})`)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for: ${what}`);
}
async function go(url) {
  await send("Page.navigate", { url });
  await sleep(300);
  await js("window.confirm = () => true; return 1");
}
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["✓", name]);
  } catch (e) {
    results.push(["✗", `${name} — ${e.message}`]);
  }
}
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click(); return 1`);
const text = () => js("return document.body.innerText");
const toast = () => js("return document.getElementById('toast').textContent");
const tab = async (id, ready) => {
  await js(`location.hash = '#/${id}'; window.confirm = () => true; return 1`);
  await until(ready, `${id} pane`);
};

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");

  await step("sign-in page offers a magic link and no sign-up", async () => {
    await go(`${ORIGIN}/`);
    await until("document.querySelector('[data-form=send-link]')", "sign-in form");
    await js("const f=document.querySelector('[data-form=send-link]'); f.elements.email.value='nobody@avidproblemsolvers.com'; f.requestSubmit(); return 1");
    await until("document.querySelector('.message').textContent.includes('If that address is authorised')", "neutral message");
  });

  await step("sign-in page refuses an off-domain address without requesting a link", async () => {
    await go(`${ORIGIN}/`);
    await until("document.querySelector('[data-form=send-link]')", "sign-in form");
    await js("window.__otp = 0; const f0 = window.fetch; window.fetch = (u, i) => (String(u).includes('/otp') && window.__otp++, f0(u, i)); return 1");
    await js("const f=document.querySelector('[data-form=send-link]'); f.elements.email.value='boss@example.com'; f.requestSubmit(); return 1");
    await until("document.querySelector('.message').textContent.includes('Use your @avidproblemsolvers.com address')", "domain message");
    if (await js("return window.__otp")) throw new Error("an off-domain link was requested");
  });

  await step("page bypassed: an off-domain account with an owner row gets Not authorised", async () => {
    await go(`${ORIGIN}/#access_token=token-${ID.outsider}&refresh_token=r-${ID.outsider}&expires_in=3600`);
    await until("document.querySelector('h1')?.textContent === 'Not authorised'", "Not authorised screen");
    if (await js("return document.querySelectorAll('.tabs a').length")) throw new Error("tabs rendered");
    await js("localStorage.clear(); return 1");
  });

  await step("owner signs in and sees all ten tabs", async () => {
    await go(`${ORIGIN}/#access_token=token-${ID.owner}&refresh_token=r-${ID.owner}&expires_in=3600`);
    await until("document.querySelectorAll('.tabs a').length === 10", "10 tabs");
    await until("location.hash === '' || location.hash === '#/bookings'", "tokens stripped from URL");
  });

  await step("bookings: expand shows the brief; email booking link sends", async () => {
    await until("document.querySelector('[data-click=expand]')", "rows");
    await js("[...document.querySelectorAll('[data-click=expand]')].find(b => b.closest('tr').innerText.includes('Daniel')).click(); return 1");
    await until("document.body.innerText.includes('Five days, predictably.')", "brief text");
    await click("[data-click=email-link]");
    await until("document.getElementById('toast').textContent.includes('Booking link sent')", "toast");
  });

  await step("bookings: search filter narrows the table without losing focus", async () => {
    await js("const i=document.querySelector('input[name=q]'); i.focus(); i.value='mei'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelectorAll('[data-region=table] tbody tr').length === 1", "one row");
    if (!(await js("return document.activeElement?.name === 'q'"))) throw new Error("search lost focus");
  });

  await step("content: edit, save (audited), publish to Live", async () => {
    await tab("content", "document.querySelector('[data-key=\"offer.cta\"] textarea')");
    await js("const t=document.querySelector('textarea[data-key=\"offer.cta\"]'); t.value='Book an hour'; t.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelector('[data-region=savebar]').innerText.includes('1 unsaved')", "unsaved count");
    await click("[data-click=save]");
    await until("document.getElementById('toast').textContent.includes('Saved 1 field')", "saved toast");
    await click("[data-click=publish]");
    await until("document.querySelector('[data-region=status]').textContent.includes('Live')", "build Live", 20000);
  });

  await step("settings: switch to the Live button in one save", async () => {
    await tab("settings", "document.querySelector('input[name=razorpay_button_id_live]')");
    await js("const i=document.querySelector('input[name=razorpay_button_id_live]'); i.value='bad'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelector('[data-error=razorpay_button_id_live]').textContent.includes('pl_')", "inline validation");
    await js("const i=document.querySelector('input[name=razorpay_button_id_live]'); i.value='pl_LiveLiveLive01'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await click("[data-click=mode][data-v=live]");
    await click("[data-click=save]");
    await until("document.querySelector('.mode-banner').innerText.includes('Live-mode')", "LIVE banner");
  });

  await step("slot requests: approve books the client", async () => {
    await tab("slot-requests", "document.querySelector('[data-click=approve]')");
    await click("[data-click=approve]");
    await until("document.getElementById('toast').textContent.includes('Approved')", "approved toast");
    await until("document.body.innerText.includes('No pending requests')", "list empty");
  });

  await step("availability: add a whole-day block, preview updates", async () => {
    await tab("availability", "document.querySelector('[data-submit=add-override]')");
    const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await js(`const f=document.querySelector('[data-submit=add-override]'); f.elements.date.value='${date}'; f.requestSubmit(); return 1`);
    await until("document.body.textContent.includes('Blocked')", "override row");
  });

  await step("answers: create a draft with a short summary shows the 40–60 warning", async () => {
    await tab("answers", "document.querySelector('[data-submit=save]')");
    await js(`const f=document.querySelector('[data-submit=save]');
      for (const [k,v] of [['title','How long does a diagnosis take?'],['summary','About an hour.'],['body_md','Body.']]) { f.elements[k].value=v; f.elements[k].dispatchEvent(new Event('input',{bubbles:true})); }
      return 1`);
    await until("document.querySelector('[data-region=summary]').innerText.includes('aim for 40–60')", "word warning");
    await until("document.querySelector('input[name=slug]').value === 'how-long-does-a-diagnosis-take'", "auto slug");
    await js("document.querySelector('[data-submit=save]').requestSubmit(); return 1");
    await until("document.querySelector('.answer-list').innerText.includes('How long does a diagnosis take?')", "in list");
  });

  await step("team: change a role", async () => {
    await tab("team", "document.querySelector('[data-change=role]')");
    await js("const s=[...document.querySelectorAll('[data-change=role]')].find(x => x.closest('tr').innerText.includes('admin@')); s.value='team'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1");
    await until("document.getElementById('toast').textContent.includes('Role changed')", "role toast");
  });

  await step("audit: every write above is there, with no edit or delete control", async () => {
    await tab("audit", "document.querySelector('tbody')");
    const t = await text();
    for (const a of ["CONTENT.UPDATE", "SITE.PUBLISH", "SITE_SETTINGS.UPDATE", "SLOT_REQUEST.APPROVE", "AVAILABILITY.OVERRIDE_BLOCK", "ANSWER.CREATE", "TEAM.ROLE", "BOOKING.EMAIL_LINK"]) {
      if (!t.toUpperCase().includes(a)) throw new Error(`missing ${a}`);
    }
    const controls = await js("return document.querySelectorAll('tbody button, tbody input, tbody select, tbody textarea').length");
    if (controls) throw new Error(`${controls} controls inside audit rows`);
  });

  await step("signals: converted-only view", async () => {
    await tab("signals", "document.querySelector('[data-click=converted-only]')");
    await click("[data-click=converted-only][data-v=yes]");
    await until("document.querySelectorAll('.signal').length === 2", "2 converted");
  });

  await step("traffic: 7-day range", async () => {
    await tab("traffic", "document.querySelector('[data-click=days]')");
    await click("[data-click=days][data-days='7']");
    await until("document.querySelectorAll('.bars rect').length === 7", "7 bars");
  });

  await step("team member: three tabs, no revenue, no write controls, no way into audit", async () => {
    await js("localStorage.clear(); return 1");
    await go(`${ORIGIN}/#access_token=token-${ID.team}&refresh_token=r-${ID.team}&expires_in=3600`);
    await until("document.querySelectorAll('.tabs a').length === 3", "3 tabs").catch(async (e) => {
      throw new Error(`${e.message}: ${await js("return document.querySelectorAll('.tabs a').length + ' tabs, hash ' + location.hash + ', ' + document.body.innerText.slice(0, 80)")}`);
    });
    await until("document.querySelector('[data-click=expand]')", "bookings rows");
    const t = await text();
    if (/revenue|amount/i.test(t)) throw new Error("revenue visible");
    if (await js("return document.querySelectorAll('[data-click=email-link],[data-click=csv]').length")) throw new Error("write control rendered");
    await js("location.hash = '#/audit'; return 1");
    await sleep(500);
    if (!(await js("return location.hash === '#/bookings'"))) throw new Error("audit route was not refused");
  });
} finally {
  for (const [mark, name] of results) console.log(`${mark} ${name}`);
  ws?.close();
  chrome.kill();
  mock.kill();
  const failed = results.filter(([m]) => m === "✗").length;
  console.log(failed ? `\n${failed} step(s) failed` : `\nall ${results.length} steps passed`);
  process.exitCode = failed ? 1 : 0;
}
