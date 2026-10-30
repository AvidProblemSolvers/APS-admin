// Pane timing in a real browser, fully offline: starts the mock, drives local headless
// Chrome over the DevTools protocol, signs in as the owner and clicks every tab twice
// (first visit, then revisit). For each click it records:
//   - ms from the click to the first paint of real data in the pane (Loading/skeleton
//     placeholders do not count)
//   - ms from the click to the first paint of anything in the pane
//   - the Edge Function / auth calls the click caused, and whether they overlapped
//
//   node scripts/measure_panes.mjs [--runs 3] [--latency-ms 0] [--cold-ms 0] [--json out.json]
//
// --latency-ms / --cold-ms are passed to the mock: they MODEL server time (a round trip to
// an Edge Function, and the extra cost of its first, cold invocation). They are not
// measurements of Supabase. With both at 0 the numbers are pure client cost.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 8031;
const CDP = 9343;
const ORIGIN = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OWNER = "00000000-0000-4000-8000-000000000001";
const TABS = ["bookings", "slot-requests", "availability", "content", "answers", "signals", "traffic", "team", "audit", "settings"];
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const RUNS = Number(arg("--runs", 3));
const LATENCY = Number(arg("--latency-ms", 0));
const COLD = Number(arg("--cold-ms", 0));
const JSON_OUT = arg("--json", null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(fn) {
  const mock = spawn(process.execPath, ["scripts/mock_functions.mjs", "--port", String(PORT), "--latency-ms", String(LATENCY), "--cold-ms", String(COLD)], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ok) => mock.stdout.on("data", (d) => String(d).includes("mock on") && ok()));
  const profile = mkdtempSync(join(ROOT, ".tmp", "measure-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--window-size=1300,900", "about:blank"], { stdio: "ignore" });
  let ws, seq = 0;
  const pending = new Map();
  const net = new Map(); // requestId → { url, start, end }
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok) => ws.addEventListener("open", ok));
      }
    } catch { /* not up yet */ }
    if (!ws) await sleep(200);
  }
  if (!ws) throw new Error("Chrome did not start");
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) return pending.get(m.id)(m);
    const p = m.params;
    if (m.method === "Network.requestWillBeSent" && /\/(functions|auth)\/v1\//.test(p.request.url)) {
      net.set(p.requestId, { url: p.request.url, body: p.request.postData, start: p.timestamp * 1000, end: null });
    }
    if ((m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") && net.has(p.requestId)) net.get(p.requestId).end = p.timestamp * 1000;
  });
  const send = (method, params = {}) => new Promise((ok) => {
    const id = ++seq;
    pending.set(id, ok);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result?.result?.value;
  };
  const until = async (expr, what, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(`return Boolean(${expr})`)) return;
      await sleep(25);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  await send("Network.enable");
  await send("Page.enable");
  try {
    return await fn({ send, js, until, net });
  } finally {
    ws.close();
    chrome.kill();
    mock.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

// A pane shows real data once it has content and no loading placeholder in it.
const READY = `(() => { const p = document.getElementById('pane'); return p && p.children.length && !p.querySelector('.loading, [data-skeleton]'); })()`;

/** Clicks a tab and returns { first, data, calls, shape }. */
async function visit({ js, until, net }, id) {
  await until(READY, "previous pane settled");
  await sleep(150);
  net.clear();
  const r = await js(`
    const old = document.getElementById('pane');
    const a = document.querySelector('.tabs a[href="#/${id}"]');
    const ready = () => { const p = document.getElementById('pane'); return p && p.children.length && !p.querySelector('.loading, [data-skeleton]'); };
    return await new Promise((done) => {
      let first = null;
      const paint = (f) => requestAnimationFrame(() => setTimeout(() => f(performance.now() - t0)));
      const check = () => {
        const p = document.getElementById('pane');
        if (!p || p === old || !p.children.length) return;
        if (first === null) { first = 0; paint((t) => (first = t)); }
        if (ready()) { obs.disconnect(); paint((t) => done({ first: first || t, data: t })); }
      };
      const obs = new MutationObserver(check);
      obs.observe(document.getElementById('app'), { childList: true, subtree: true });
      const t0 = performance.now();
      a.click();
    });`);
  await sleep(400); // let any trailing request finish
  const reqs = [...net.values()].sort((x, y) => x.start - y.start);
  let shape = reqs.length === 0 ? "none" : reqs.length === 1 ? "single" : "serial";
  for (let i = 1; i < reqs.length; i++) if (reqs[i].start < (reqs[i - 1].end ?? Infinity)) shape = "parallel";
  return { ...r, calls: reqs.length, shape, urls: reqs.map((q) => q.url.replace(/^.*\/v1\//, "") + (q.body ? ` ${JSON.parse(q.body).action ?? ""}` : "")) };
}

async function signInAndLand(s, landing) {
  await s.send("Page.navigate", { url: `${ORIGIN}/#access_token=token-${OWNER}&refresh_token=r-${OWNER}&expires_in=3600&token_type=bearer&type=magiclink` });
  await s.until("document.querySelectorAll('.tabs a').length === 10", "signed in");
  await s.js(`location.hash = '#/${landing}'; return 1`);
  await s.send("Page.reload");
  await sleep(300);
  await s.until(`document.querySelectorAll('.tabs a').length === 10 && location.hash === '#/${landing}'`, "landing");
  await s.until(READY, "landing pane");
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const runs = [];
for (let run = 0; run < RUNS; run++) {
  const out = { first: {}, revisit: {} };
  // Load 1 lands on Settings, then clicks the other nine (first visits) and all ten again.
  await session(async (s) => {
    await signInAndLand(s, "settings");
    for (const id of TABS.slice(0, 9)) out.first[id] = await visit(s, id);
    for (const id of TABS) out.revisit[id] = await visit(s, id);
  });
  // Load 2 (fresh mock and page) lands on Bookings and clicks Settings for its first visit.
  await session(async (s) => {
    await signInAndLand(s, "bookings");
    out.first.settings = await visit(s, "settings");
  });
  runs.push(out);
  process.stderr.write(`run ${run + 1}/${RUNS} done\n`);
}

const rows = TABS.map((id) => {
  const pick = (kind) => {
    const xs = runs.map((r) => r[kind][id]);
    return { data: Math.round(median(xs.map((x) => x.data))), first: Math.round(median(xs.map((x) => x.first))), calls: xs[0].calls, shape: xs[0].shape, urls: xs[0].urls };
  };
  return { id, first: pick("first"), revisit: pick("revisit") };
});

console.log(`\nlatency ${LATENCY} ms, cold start ${COLD} ms, median of ${RUNS} run(s)\n`);
console.log("| Tab | 1st: data ms | 1st: any paint ms | 1st: calls | Revisit: data ms | Revisit: any paint ms | Revisit: calls |");
console.log("|---|---:|---:|---|---:|---:|---|");
for (const r of rows) {
  const c = (x) => `${x.calls} ${x.shape === "single" ? "" : `(${x.shape})`}`.trim();
  console.log(`| ${r.id} | ${r.first.data} | ${r.first.first} | ${c(r.first)} | ${r.revisit.data} | ${r.revisit.first} | ${c(r.revisit)} |`);
}
console.log("\ncalls per click:");
for (const r of rows) console.log(`  ${r.id.padEnd(14)} first: ${r.first.urls.join(", ") || "-"}   revisit: ${r.revisit.urls.join(", ") || "-"}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ latency: LATENCY, cold: COLD, runs: RUNS, rows }, null, 2));
