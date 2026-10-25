#!/usr/bin/env python3
"""Static checks for the admin. Exits non-zero on any failure.

Builds a mock bundle into .tmp/check-dist and validates: HTML, noindex, CSP, tokens-only
colours, no Fraunces, no inline styles or scripts, robots.txt, the settings validator copy,
every Edge Function's shape, no IP headers, no remote imports, and the append-only audit log.
"""
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FAIL = []


def fail(msg):
    FAIL.append(msg)


def files(base, exts):
    return [p for p in (ROOT / base).rglob("*") if p.is_file() and p.suffix in exts]


# --- build ---------------------------------------------------------------------------------
r = subprocess.run([sys.executable, "build.py", "--mock", "--out", ".tmp/check-dist"], cwd=ROOT, capture_output=True, text=True)
if r.returncode:
    print(r.stdout, r.stderr)
    sys.exit("check.py: build failed")
DIST = ROOT / ".tmp" / "check-dist"

# --- HTML ----------------------------------------------------------------------------------
VOID = {"meta", "link", "img", "br", "input", "hr", "source"}


class Checker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.meta, self.scripts, self.inline = [], {}, [], []
        self.lang = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        if tag == "meta" and "name" in a:
            self.meta[a["name"]] = a.get("content", "")
        if tag == "script":
            self.scripts.append(a)
        if "style" in a or any(k.startswith("on") for k in a):
            self.inline.append(tag)
        if tag == "style":
            self.inline.append("style element")
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack or self.stack[-1] != tag:
            fail("index.html: unbalanced </%s> (open: %s)" % (tag, self.stack[-3:]))
        else:
            self.stack.pop()

    def handle_data(self, data):
        if self.stack and self.stack[-1] == "script" and data.strip():
            fail("index.html: inline script content")


html = (DIST / "index.html").read_text()
c = Checker()
c.feed(html)
if c.stack:
    fail("index.html: unclosed tags %s" % c.stack)
if c.lang != "en":
    fail("index.html: <html lang> missing")
if "noindex" not in c.meta.get("robots", ""):
    fail("index.html: robots noindex meta missing")
if "viewport" not in c.meta:
    fail("index.html: viewport meta missing")
if [s.get("type") for s in c.scripts] != ["module"] or c.scripts[0].get("src") != "/js/app.js":
    fail("index.html: expected exactly one module script, /js/app.js")
if c.inline:
    fail("index.html: inline style/handler on %s" % c.inline)
if "<title>" not in html:
    fail("index.html: no <title>")

# --- headers & robots ----------------------------------------------------------------------
headers = (DIST / "_headers").read_text()
for needle in ["Content-Security-Policy:", "script-src 'self'", "frame-ancestors 'none'", "X-Robots-Tag: noindex",
               "X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer"]:
    if needle not in headers:
        fail("_headers: missing %s" % needle)
if "unsafe-inline" in headers or "unsafe-eval" in headers:
    fail("_headers: CSP must not allow unsafe-inline / unsafe-eval")
robots = (DIST / "robots.txt").read_text().split()
if robots != ["User-agent:", "*", "Disallow:", "/"]:
    fail("robots.txt must disallow everything")

# --- colours: tokens only --------------------------------------------------------------------
ALLOWED_HEX = {"#07211f", "#0e3330", "#f2efe7", "#ffffff", "#4fc1bc", "#7fe9e1", "#8fa9a6", "#f0c27b", "#e8977a"}
ALLOWED_RGB = {"242,239,231", "79,193,188", "127,233,225", "240,194,123", "232,151,122"}
for p in files("public", {".css", ".js", ".html"}):
    src = p.read_text()
    for h in re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])", src):
        if h.lower() not in ALLOWED_HEX and not re.search(r"&#\d|#/|#[0-9a-f]{3}\b", h.lower()) :
            fail("%s: colour %s is not a design token" % (p.relative_to(ROOT), h))
    for m in re.findall(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", src):
        if ",".join(m) not in ALLOWED_RGB:
            fail("%s: rgb(%s) is not a design token" % (p.relative_to(ROOT), ",".join(m)))
    if re.search(r"\b(hsl|hwb|lab|lch|oklch)\(", src):
        fail("%s: non-token colour function" % p.relative_to(ROOT))
    if "Fraunces" in src:
        fail("%s: Fraunces is not used in the admin" % p.relative_to(ROOT))

css = (ROOT / "public/css/admin.css").read_text()
if re.search(r"@keyframes|animation\s*:(?!\s*none)", css):
    fail("admin.css: no animations — the only motion is a 150ms colour transition")
for t in re.findall(r"transition:\s*([^;]+);", css):
    if "none" not in t and not all("var(--t) var(--ease)" in part for part in t.split(",")):
        fail("admin.css: transition must use var(--t) var(--ease): %s" % t)
if "--t: 150ms" not in css or "cubic-bezier(0.16, 1, 0.3, 1)" not in css:
    fail("admin.css: motion tokens changed")
if "prefers-reduced-motion" not in css:
    fail("admin.css: reduced-motion rule missing")

# --- JS views ----------------------------------------------------------------------------------
for p in files("public/js", {".js"}):
    src = p.read_text()
    rel = p.relative_to(ROOT)
    if re.search(r'\bstyle="', src):
        fail("%s: inline style attribute (blocked by CSP)" % rel)
    if re.search(r"\binnerHTML\s*=\s*`", src) and "app.js" not in str(rel):
        fail("%s: raw innerHTML template — use html``" % rel)
    if re.search(r"\b(eval|new Function)\(", src):
        fail("%s: eval" % rel)
auth = (ROOT / "public/js/lib/auth.js").read_text()
if "create_user: false" not in auth:
    fail("auth.js: magic links must send create_user: false")
if re.search(r"type=.?password|signUp|/signup", auth):
    fail("auth.js: no password or sign-up path may exist")

for name in ("settings_schema.js", "email_domain.js"):
    a = (ROOT / "supabase/functions/_shared" / name).read_bytes()
    b = (ROOT / "public/js/shared" / name).read_bytes()
    if a != b:
        fail("public/js/shared/%s differs from supabase/functions/_shared/ — run build.py" % name)

# The email domain is written once, in _shared/email_domain.js, and the server gate uses it
# before the team_members lookup.
for p in files("supabase", {".ts", ".js"}) + files("public/js", {".js"}):
    if p.name != "email_domain.js" and "@avidproblemsolvers.com" in p.read_text():
        fail("%s: hard-codes the email domain — use _shared/email_domain.js" % p.relative_to(ROOT))
http_src = (ROOT / "supabase/functions/_shared/http.ts").read_text()
gate = http_src.find("inAllowedDomain(user.email")
if gate < 0 or gate > http_src.find('"team_members"'):
    fail("_shared/http.ts must check the email domain before the team_members lookup")

# --- Edge Functions ----------------------------------------------------------------------------
fn_dirs = [d for d in (ROOT / "supabase/functions").iterdir() if d.is_dir() and not d.name.startswith("_")]
registry = (ROOT / "mock/functions.ts").read_text()
for d in fn_dirs:
    idx, handler = d / "index.ts", d / "handler.ts"
    if not idx.exists() or not handler.exists():
        fail("%s: needs index.ts and handler.ts" % d.name)
        continue
    i = idx.read_text()
    if "serve(spec, req, deps)" not in i:
        fail("%s/index.ts must route through the shared serve() pipeline" % d.name)
    h = handler.read_text()
    if 'name: "%s"' % d.name not in h:
        fail("%s/handler.ts: spec.name must equal the directory name" % d.name)
    for action, body in re.findall(r"(\w+):\s*\{\s*roles:\s*(\[[^\]]*\])", h):
        if not re.fullmatch(r'\[\s*("(owner|admin|team)",?\s*)+\]', body):
            fail("%s: action %s has an invalid roles list %s" % (d.name, action, body))
    if 'functions/%s/handler.ts' % d.name not in registry:
        fail("%s is not registered in mock/functions.ts (so it is untested)" % d.name)

for p in files("supabase", {".ts", ".js"}) + files("public/js", {".js"}) + files("scripts", {".mjs", ".js"}):
    src = p.read_text()
    rel = p.relative_to(ROOT)
    if re.search(r"x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|remote_?addr", src, re.I):
        fail("%s: reads an IP header — rule 6" % rel)
    if re.search(r"""(import|from)\s*\(?\s*["']https?:""", src) or "esm.sh" in src or "@supabase/supabase-js" in src:
        fail("%s: remote import" % rel)
    if re.search(r"""\b(update|delete)\(\s*["'`]audit_log""", src) or re.search(r"audit_log[^\n]{0,40}\b(PATCH|DELETE)\b", src):
        fail("%s: update/delete against audit_log — the audit log is append-only" % rel)

audit_fn = (ROOT / "supabase/functions/admin-audit/handler.ts").read_text()
acts = re.findall(r"^\s{4}(\w+):\s*\{\s*roles", audit_fn, re.M)
if sorted(acts) != ["export_csv", "list"]:
    fail("admin-audit must expose exactly list and export_csv, found %s" % acts)
settings_fn = (ROOT / "supabase/functions/admin-settings/handler.ts").read_text()
if re.search(r"audit\(|audit_log", re.sub(r"//.*", "", settings_fn)):
    fail("admin-settings must not write its own audit row (the DB trigger does)")
if "updated_by: ctx.actor.id" not in settings_fn:
    fail("admin-settings must set updated_by")

# --- result --------------------------------------------------------------------------------------
if FAIL:
    print("check.py: %d problem(s)" % len(FAIL))
    for f in FAIL:
        print("  ✗ " + f)
    sys.exit(1)
print("check.py: all checks passed (%d functions, %d public files)" % (len(fn_dirs), len(files("public", {".js", ".css", ".html"}))))
