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

  const BAD_CODE = "That code did not work";
  const enterCode = (code) => js(`const f=document.querySelector('[data-form=verify-code]'); f.elements.code.value=${JSON.stringify(code)}; f.requestSubmit(); return 1`);

  await step("sign-in page offers a code and no sign-up; an unknown address looks the same", async () => {
    await go(`${ORIGIN}/`);
    await until("document.querySelector('[data-form=send-link]')", "sign-in form");
    await js("const f=document.querySelector('[data-form=send-link]'); f.elements.email.value='nobody@avidproblemsolvers.com'; f.requestSubmit(); return 1");
    await until("document.querySelector('.message').textContent.includes('If that address is authorised')", "neutral message");
    await until("document.querySelector('[data-form=verify-code] input[autocomplete=one-time-code][inputmode=numeric]')", "code field");
    if (/link/i.test(await js("return document.querySelector('[data-form=send-link] button').textContent"))) throw new Error("button still offers a link");
    await enterCode("123456");
    await until(`document.querySelector('.message').textContent.includes(${JSON.stringify(BAD_CODE)})`, "bad-code message");
  });

  await step("owner signs in with an emailed code (a wrong code first gets the same plain message)", async () => {
    await go(`${ORIGIN}/`);
    await until("document.querySelector('[data-form=send-link]')", "sign-in form");
    await js("const f=document.querySelector('[data-form=send-link]'); f.elements.email.value='Owner@AvidProblemSolvers.com'; f.requestSubmit(); return 1");
    await until("document.querySelector('[data-form=verify-code]')", "code field");
    if (!(await js("return document.activeElement?.name === 'code'"))) throw new Error("code field not focused");
    const code = /code (\d{6})/.exec(await (await fetch(`${ORIGIN}/__mock/links`)).text())?.[1];
    if (!code) throw new Error("mock issued no code");
    await enterCode(code === "000000" ? "111111" : "000000");
    await until(`document.querySelector('.message').textContent.includes(${JSON.stringify(BAD_CODE)})`, "bad-code message");
    await enterCode(code);
    await until("document.querySelectorAll('.tabs a').length === 10", "10 tabs");
    await click("[data-signout]");
    await until("document.querySelector('[data-form=send-link]')", "signed out");
  });

  await step("sign-in page refuses an off-domain address without requesting a link", async () => {
    await go(`${ORIGIN}/`);
    await until("document.querySelector('[data-form=send-link]')", "sign-in form");
    await js("window.__otp = 0; const f0 = window.fetch; window.fetch = (u, i) => (String(u).includes('/otp') && window.__otp++, f0(u, i)); return 1");
    await js("const f=document.querySelector('[data-form=send-link]'); f.elements.email.value='boss@example.com'; f.requestSubmit(); return 1");
    await until("document.querySelector('.message').textContent.includes('Use your @avidproblemsolvers.com address')", "domain message");
    if (await js("return window.__otp")) throw new Error("an off-domain code was requested");
    if (await js("return document.querySelector('[data-form=verify-code]')")) throw new Error("code field shown for an off-domain address");
  });

  await step("page bypassed: an off-domain account with an owner row gets Not authorised", async () => {
    await go(`${ORIGIN}/#access_token=token-${ID.outsider}&refresh_token=r-${ID.outsider}&expires_in=3600`);
    await until("document.querySelector('h1')?.textContent === 'Not authorised'", "Not authorised screen");
    if (await js("return document.querySelectorAll('.tabs a').length")) throw new Error("tabs rendered");
    await js("localStorage.clear(); return 1");
  });

  await step("a link in the URL fragment still signs the owner in: all ten tabs", async () => {
    await go(`${ORIGIN}/#access_token=token-${ID.owner}&refresh_token=r-${ID.owner}&expires_in=3600`);
    await until("document.querySelectorAll('.tabs a').length === 10", "10 tabs");
    await until("location.hash === '' || location.hash === '#/bookings'", "tokens stripped from URL");
  });

  await step("a revisited tab paints from memory with no request", async () => {
    await js("window.__fn = []; const f0 = window.fetch; window.fetch = (u, i) => (String(u).includes('/functions/v1/') && window.__fn.push(String(u).split('/').pop() + ' ' + JSON.parse(i?.body || '{}').action), f0(u, i)); return 1");
    const ready = "document.getElementById('pane')?.children.length && !document.querySelector('#pane .loading')";
    await tab("audit", `${ready} && document.querySelector('#pane table')`);
    await tab("bookings", "document.querySelector('[data-click=expand]')");
    await tab("audit", `${ready} && document.querySelector('#pane table')`);
    await tab("bookings", "document.querySelector('[data-click=expand]')");
    const calls = await js("return window.__fn.join(', ')");
    if (calls !== "admin-audit list") throw new Error(`requests: ${calls}`);
  });

  await step("bookings: expand shows the brief; email booking link sends", async () => {
    await until("document.querySelector('[data-click=expand]')", "rows");
    await js("[...document.querySelectorAll('[data-click=expand]')].find(b => b.closest('tr').innerText.includes('Daniel')).click(); return 1");
    await until("document.body.innerText.includes('Five days, predictably.')", "brief text");
    await click("[data-click=email-link]");
    await until("document.getElementById('toast').textContent.includes('Booking link sent')", "toast");
  });

  await step("a write clears cached tabs: Audit fetches again and shows the email-link row", async () => {
    await js("window.__fn.length = 0; return 1");
    await tab("audit", "document.querySelector('#pane table') && document.getElementById('pane').innerText.toUpperCase().includes('BOOKING.EMAIL_LINK')");
    const calls = await js("return window.__fn.join(', ')");
    if (calls !== "admin-audit list") throw new Error(`requests: ${calls}`);
    await tab("bookings", "document.querySelector('[data-click=expand]')");
  });

  await step("bookings: search filter narrows the table without losing focus", async () => {
    await js("const i=document.querySelector('input[name=q]'); i.focus(); i.value='mei'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelectorAll('[data-region=table] tbody tr').length === 1", "one row");
    if (!(await js("return document.activeElement?.name === 'q'"))) throw new Error("search lost focus");
  });

  await step("content: sections nested by every dot, search across sections, tab survives reload", async () => {
    await tab("content", "document.querySelector('.subtabs a[aria-current=page]')");
    const tabs = await js("return [...document.querySelectorAll('.subtabs a')].map((a) => a.dataset.tab).join(',')");
    if (tabs !== "hero,home,what,how,offer,answers_index") throw new Error(`tabs not in sort_order: ${tabs}`);
    if ((await js("return document.querySelector('.subtabs a[data-tab=answers_index]').firstChild.textContent")) !== "Answers Index") throw new Error("tab label not derived");
    await click(".subtabs a[data-tab=answers_index]");
    await until("document.querySelector('.subtabs a[aria-current=page]')?.dataset.tab === 'answers_index'", "answers index tab");
    // Top-level fields first, no heading above them; then Categories › Buying › Lead › Cta, four deep.
    if ((await js("return document.querySelector('.ctree > .cfields textarea')?.value.split('\\n')[0]")) !== "Title: Answers") throw new Error("Title is not first");
    const deep = await js("const l = document.querySelector('textarea[data-group=\"answers_index.categories.buying.lead.cta\"]'); let n = 0, p = l; while ((p = p.parentElement.closest('.cgroup'))) n++; return n + ' ' + l.value");
    if (deep !== "4 Label: Read the guide") throw new Error(`six-segment key: ${deep}`);
    const d2 = await js("return document.querySelector('[data-path=\"answers_index.categories.buying\"]').getBoundingClientRect().left");
    const d3 = await js("return document.querySelector('[data-path=\"answers_index.categories.buying.lead\"]').getBoundingClientRect().left");
    if (!(d3 > d2)) throw new Error("depth 3 is not indented past depth 2");
    // An unsaved edit survives switching tabs (the pane is not remounted).
    await js("const t=document.querySelector('textarea[data-group=answers_index]'); t.value=t.value.replace('Title: Answers', 'Title: Answers!'); t.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await click(".subtabs a[data-tab=hero]");
    await until("location.hash === '#/content/hero' && document.querySelector('[data-group=hero]')", "hero tab");
    if (!(await js("return document.querySelector('[data-region=savebar]').innerText.includes('1 unsaved')"))) throw new Error("edit lost on tab switch");
    await click("[data-click=discard]");
    // Search: one query, hits from two sections, each with its heading path.
    await js("const i=document.querySelector('[data-input=search]'); i.focus(); i.value='buy'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelectorAll('.hit').length === 4", "4 hits");
    if (!(await js("return document.activeElement?.dataset.input === 'search'"))) throw new Error("search lost focus");
    const path = await js("return document.querySelector('.hit:has([data-key=\"answers_index.categories.buying.lead.note\"]) .hit-path').textContent");
    if (path !== "Answers Index › Categories › Buying › Lead") throw new Error(`hit path: ${path}`);
    await js("const i=document.querySelector('[data-input=search]'); i.value='Methodology'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelector('.hit .hit-path')?.textContent === 'How'", "value hit in How");
    await click(".subtabs a[data-tab=hero]");
    await until("!document.querySelector('.hit') && document.querySelector('[data-input=search]').value === '' && document.querySelector('[data-group=hero]')", "current tab clears the search");
    await send("Page.reload");
    await sleep(300);
    await until("document.querySelector('.subtabs a[aria-current=page]')?.dataset.tab === 'hero'", "hero tab after reload");
    if (!(await js("return document.querySelector('[data-region=savebar]').innerText.includes('Saved edits are not live until you publish.')"))) throw new Error("publish notice missing");
  });

  await step("content: one textarea per group; two lines edited and saved change exactly those two keys", async () => {
    await js("location.hash = '#/content/home'; return 1");
    await until("document.querySelector('textarea[data-group=\"home.probe\"]')", "home tab");
    const keys = await js("return document.querySelector('textarea[data-group=\"home.probe\"]').dataset.keys");
    const area = "document.querySelector('textarea[data-group=\"home.probe\"]')";
    const lines = await js(`return ${area}.value`);
    const want = "Label: WHICH KIND IS YOURS?\nButton: Read it\nLink: Bring it to an hour →\nMin Chars: 10\nMin Chars Context: 3\nHint: Name it plainly: what breaks, and when.";
    if (lines !== want) throw new Error(`group text: ${JSON.stringify(lines)}`);
    if (!(await js("return document.querySelector('[data-alone=\"home.probe.examples\"] textarea')?.value.includes('\\n')"))) throw new Error("the multi-line field is not on its own");
    const overflow = await js("return [...document.querySelectorAll('textarea.autosize')].filter((t) => t.scrollHeight > t.clientHeight).length");
    if (overflow) throw new Error(`${overflow} textarea(s) need an inner scrollbar`);
    const server = async () => JSON.parse(await js("const { api } = await import('/js/lib/api.js'); return JSON.stringify(Object.fromEntries((await api('admin-content', { action: 'list' })).rows.filter((r) => r.key.startsWith('home.probe.')).map((r) => [r.key, r.value])))"));
    const before = await server();
    const type = (text) => js(`const t=${area}; t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input',{bubbles:true})); return 1`);
    // A mistyped label shows the problem and holds the save; nothing reaches the server.
    await type(want.replace("Button: Read it", "Buton: Read it"));
    await until("document.querySelector('[data-errors=\"home.probe\"]').textContent.includes('“Buton” is not a field')", "inline error");
    await until("document.querySelector('[data-errors=\"home.probe\"]').textContent.includes('“Button” is missing')", "missing label named");
    if (!(await js("return document.querySelector('[data-click=save]').disabled"))) throw new Error("save enabled with only an invalid group");
    // Fix it, edit two lines, save.
    await type(want.replace("Button: Read it", "Button: Read now").replace("Min Chars: 10", "Min Chars: 12"));
    await until("document.querySelector('[data-errors=\"home.probe\"]').textContent === '' && document.querySelector('[data-region=savebar]').innerText.includes('2 unsaved')", "2 unsaved");
    await click("[data-click=save]");
    await until("document.getElementById('toast').textContent.includes('Saved 2 fields')", "saved toast");
    const after = await server();
    const moved = Object.keys(before).filter((k) => before[k] !== after[k]).sort().join(",");
    if (moved !== "home.probe.button,home.probe.min_chars") throw new Error(`keys changed: ${moved}`);
    if (after["home.probe.button"] !== "Read now" || after["home.probe.min_chars"] !== "12") throw new Error(`values: ${JSON.stringify(after)}`);
    if ((await js("return document.querySelector('textarea[data-group=\"home.probe\"]').dataset.keys")) !== keys) throw new Error("group keys changed after save");
  });

  await step("content: edit, save (audited), publish to Live", async () => {
    await js("window.confirm = () => true; location.hash = '#/content/offer'; return 1");
    await until("document.querySelector('textarea[data-group=offer]')", "offer tab");
    await js("const t=document.querySelector('textarea[data-group=offer]'); t.value=t.value.replace('Cta: Book your hour', 'Cta: Book an hour'); t.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelector('[data-region=savebar]').innerText.includes('1 unsaved')", "unsaved count");
    await click("[data-click=save]");
    await until("document.getElementById('toast').textContent.includes('Saved 1 field')", "saved toast");
    await click("[data-click=publish]");
    await until("document.querySelector('[data-region=status]').textContent.includes('Live')", "build Live", 20000);
  });

  await step("settings: switch to the Live payment page in one save", async () => {
    await tab("settings", "document.querySelector('input[name=razorpay_payment_url_live]')");
    await js("const i=document.querySelector('input[name=razorpay_payment_url_live]'); i.value='bad'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
    await until("document.querySelector('[data-error=razorpay_payment_url_live]').textContent.includes('payment page URL')", "inline validation");
    await js("const i=document.querySelector('input[name=razorpay_payment_url_live]'); i.value='https://rzp.io/rzp/LIVEPAGE1'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1");
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

  await step("theme: toggle on sign-in, stored, applied before <body> on reload, toggled back from the header", async () => {
    const bg = () => js("return getComputedStyle(document.body).backgroundColor");
    const pressed = () => js("return [...document.querySelectorAll('[data-theme-set]')].map((b) => b.dataset.themeSet + '=' + b.getAttribute('aria-pressed')).join(' ')");
    await js("localStorage.clear(); return 1");
    await go(`${ORIGIN}/`);
    await until("document.querySelector('[data-form=send-link]')", "sign-in form");
    if ((await bg()) !== "rgb(7, 33, 31)") throw new Error(`default is not dark: ${await bg()}`);
    await click("[data-theme-set=light]");
    if ((await pressed()) !== "dark=false light=true") throw new Error(`aria-pressed: ${await pressed()}`);
    if ((await js("return localStorage.getItem('aps-admin-theme')")) !== "light") throw new Error("choice not stored");
    if ((await bg()) !== "rgb(246, 248, 247)") throw new Error(`light not applied: ${await bg()}`);
    // Record the theme at the moment <body> is created: set by then means no flash.
    const { identifier } = (await send("Page.addScriptToEvaluateOnNewDocument", { source:
      "new MutationObserver((_, o) => { if (document.body) { window.__themeAtBody = document.documentElement.dataset.theme; o.disconnect(); } }).observe(document, { childList: true, subtree: true });" })).result;
    await go(`${ORIGIN}/`);
    await until("document.querySelector('[data-form=send-link]')", "sign-in form");
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    if ((await js("return window.__themeAtBody")) !== "light") throw new Error(`theme at <body>: ${await js("return window.__themeAtBody")}`);
    if ((await pressed()) !== "dark=false light=true") throw new Error(`after reload: ${await pressed()}`);
    await go(`${ORIGIN}/#access_token=token-${ID.owner}&refresh_token=r-${ID.owner}&expires_in=3600`);
    await until("document.querySelector('.top .who [data-theme-set=dark]')", "header toggle");
    if ((await pressed()) !== "dark=false light=true") throw new Error(`header: ${await pressed()}`);
    await click(".top [data-theme-set=dark]");
    if ((await bg()) !== "rgb(7, 33, 31)" || (await js("return localStorage.getItem('aps-admin-theme')")) !== "dark") throw new Error("header toggle did not switch to dark");
    await click("[data-signout]");
    await until("document.querySelector('[data-form=send-link]')", "signed out");
    await js("localStorage.clear(); return 1");
  });

  await step("theme: storage that throws still renders dark, and the toggle still works", async () => {
    const { identifier } = (await send("Page.addScriptToEvaluateOnNewDocument", { source:
      "for (const m of ['getItem', 'setItem', 'removeItem']) Storage.prototype[m] = () => { throw new DOMException('blocked', 'SecurityError'); };" })).result;
    try {
      await go(`${ORIGIN}/`);
      await until("document.querySelector('[data-form=send-link]')", "sign-in form");
      if ((await js("return document.documentElement.dataset.theme")) !== "dark") throw new Error("not dark");
      await click("[data-theme-set=light]");
      if ((await js("return document.documentElement.dataset.theme")) !== "light") throw new Error("toggle failed with storage blocked");
    } finally {
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
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
