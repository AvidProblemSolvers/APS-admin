// Local mock of everything the admin talks to, for offline preview:
//   - serves dist/ (built with `python3 build.py --mock`) with the production _headers
//   - GoTrue: /auth/v1/otp (refuses create_user unless false), /token, /logout
//   - /functions/v1/<name> → the REAL Edge Function handlers on an in-memory database
// Magic links are printed here instead of emailed. Nothing touches the network.
//
//   node scripts/mock_functions.mjs [--port 8001]

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { makeDeps } from "../mock/fakes.ts";
import { FUNCTIONS } from "../mock/functions.ts";
import { IDS, seed } from "../mock/seed.ts";
import { serve } from "../supabase/functions/_shared/http.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8001;
const ORIGIN = `http://localhost:${PORT}`;

execFileSync("python3", ["build.py", "--mock", "--mock-origin", ORIGIN], { cwd: ROOT, stdio: "inherit" });
const DIST = join(ROOT, "dist");

const deps = makeDeps(seed(new Date()), { env: { ADMIN_ORIGIN: ORIGIN } });
deps.fakeAuth.addUser({ id: IDS.stranger, email: "stranger@example.com" });
// An off-domain account holding an active owner row: the domain lock refuses it anyway.
deps.mem.tables.team_members.push({ id: IDS.outsider, email: "boss@example.com", full_name: "Off Domain", role: "owner", active: true, created_at: new Date().toISOString() });
deps.fakeAuth.addUser({ id: IDS.outsider, email: "boss@example.com" });
const refresh = new Map();
const links = [];

function linkFor(id) {
  refresh.set(`r-${id}`, id);
  return `${ORIGIN}/#access_token=${deps.fakeAuth.tokenFor(id)}&refresh_token=r-${id}&expires_in=3600&token_type=bearer&type=magiclink`;
}

// Parse dist/_headers once (only the "/*" block matters for the mock).
const globalHeaders = {};
{
  let inAll = false;
  for (const line of readFileSync(join(DIST, "_headers"), "utf8").split("\n")) {
    if (!line.startsWith(" ")) inAll = line.trim() === "/*";
    else if (inAll) {
      const i = line.indexOf(":");
      globalHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const send = (status, data, type = "application/json") => {
    res.writeHead(status, { "Content-Type": type, ...globalHeaders });
    res.end(typeof data === "string" ? data : JSON.stringify(data));
  };

  try {
    if (url.pathname === "/auth/v1/otp" && req.method === "POST") {
      const b = JSON.parse(await body(req));
      if (b.create_user !== false) return send(400, { msg: "mock: the admin must never create users" });
      const user = await deps.fakeAuth.findUserByEmail(String(b.email).toLowerCase());
      if (user) {
        const link = linkFor(user.id);
        links.unshift({ email: user.email, link, at: new Date().toISOString() });
        console.log(`\n✉  magic link for ${user.email}:\n   ${link}\n`);
      } else {
        console.log(`\n✉  (no link: ${b.email} has no account — the UI shows the same message either way)\n`);
      }
      return send(200, {});
    }
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const b = JSON.parse(await body(req));
      const id = refresh.get(b.refresh_token);
      if (!id) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: deps.fakeAuth.tokenFor(id), refresh_token: b.refresh_token, expires_in: 3600 });
    }
    if (url.pathname === "/auth/v1/logout") return send(204, "");
    if (url.pathname === "/__mock/links") {
      return send(200, links.map((l) => `${l.at}  ${l.email}\n${l.link}\n`).join("\n") || "No links yet.\n", "text/plain; charset=utf-8");
    }

    const fn = /^\/functions\/v1\/([a-z-]+)$/.exec(url.pathname)?.[1];
    if (fn) {
      const spec = FUNCTIONS[fn];
      if (!spec) return send(404, { error: "no such function" });
      const raw = req.method === "POST" ? await body(req) : undefined;
      const request = new Request(url, { method: req.method, headers: { ...req.headers, "cf-ipcountry": "IN" }, body: raw });
      const r = await serve(spec, request, deps);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      if (deps.fakeMail.sent.length) {
        for (const m of deps.fakeMail.sent.splice(0)) console.log(`\n✉  to ${m.to}: ${m.subject}\n${m.text.replace(/^/gm, "   ")}\n`);
      }
      return;
    }

    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path === "/" || path === "") path = "/index.html";
    const file = join(DIST, path);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) return send(404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache", ...globalHeaders });
    res.end(readFileSync(file));
  } catch (e) {
    console.error(e);
    send(500, { error: "mock_error" });
  }
});

server.listen(PORT, () => {
  console.log(`\nAPS Admin mock on ${ORIGIN}`);
  console.log("Sign in by pasting one of these into the browser (or request a link from the UI):");
  for (const who of ["owner", "admin", "team", "inactive", "stranger"]) console.log(`  ${who.padEnd(9)} ${linkFor(IDS[who])}`);
  console.log(`Links requested from the UI are also listed at ${ORIGIN}/__mock/links\n`);
});
