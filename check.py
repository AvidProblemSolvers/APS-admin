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
            self.scripts.append(dict(a, in_head="head" in self.stack))
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
if [(s.get("src"), s.get("type")) for s in c.scripts] != [("/js/theme-init.js", None), ("/js/app.js", "module")]:
    fail("index.html: expected exactly two scripts: classic /js/theme-init.js, then module /js/app.js")
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
HEX_RE = r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])"
for p in files("public", {".css", ".js", ".html"}):
    src = p.read_text()
    if p.suffix == ".css":
        if "Fraunces" in src:
            fail("%s: Fraunces is not used in the admin" % p.relative_to(ROOT))
        continue  # CSS colours: see the theme guards below
    for h in re.findall(HEX_RE, src):
        if h.lower() not in ALLOWED_HEX and not re.search(r"&#\d|#/|#[0-9a-f]{3}\b", h.lower()) :
            fail("%s: colour %s is not a design token" % (p.relative_to(ROOT), h))
    for m in re.findall(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", src):
        if ",".join(m) not in ALLOWED_RGB:
            fail("%s: rgb(%s) is not a design token" % (p.relative_to(ROOT), ",".join(m)))
    if re.search(r"\b(hsl|hwb|lab|lch|oklch)\(", src):
        fail("%s: non-token colour function" % p.relative_to(ROOT))
    if "Fraunces" in src:
        fail("%s: Fraunces is not used in the admin" % p.relative_to(ROOT))

# --- themes: colours only in the two token blocks ----------------------------------------------
# :root holds the dark default (the CLAUDE.md palette, nothing else); :root[data-theme="light"]
# redefines every token. A raw colour anywhere else in the CSS fails, and so does a token that
# exists in one block but not the other.
NAMED = set("""aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred
darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray
green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen
lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen
linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy
oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip
peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen canvas canvastext linktext
visitedtext activetext buttonface buttontext buttonborder field fieldtext highlight highlighttext mark marktext
graytext accentcolor accentcolortext selecteditem selecteditemtext""".split())
COLOUR_FN = r"\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\("
DARK_BLOCK = r'^:root\s*\{([^}]*)\}'
LIGHT_BLOCK = r'^:root\[data-theme="light"\]\s*\{([^}]*)\}'


def theme_problems(css_src, name="admin.css"):
    """Every theme-guard failure for one stylesheet's source (a function so it can be mutation-tested)."""
    out = []
    src = re.sub(r"/\*.*?\*/", "", css_src, flags=re.S)
    dark, light = re.findall(DARK_BLOCK, src, re.M), re.findall(LIGHT_BLOCK, src, re.M)
    if len(dark) != 1 or len(light) != 1:
        return ["%s: needs exactly one :root block and one :root[data-theme=\"light\"] block" % name]
    toks = lambda block: dict((k, v.strip()) for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block))
    d, l = toks(dark[0]), toks(light[0])
    for t in sorted(set(d) - set(l)):
        out.append("%s: token %s has no light value under :root[data-theme=\"light\"]" % (name, t))
    for t in sorted(set(l) - set(d)):
        out.append("%s: light token %s has no dark value on :root" % (name, t))
    for t, v in d.items():
        for h in re.findall(HEX_RE, v):
            if h.lower() not in ALLOWED_HEX:
                out.append("%s: dark token %s = %s is not a CLAUDE.md colour" % (name, t, h))
        for m in re.findall(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", v):
            if ",".join(m) not in ALLOWED_RGB:
                out.append("%s: dark token %s = rgb(%s) is not a CLAUDE.md colour" % (name, t, ",".join(m)))
    rest = re.sub(DARK_BLOCK, "", src, flags=re.M)
    rest = re.sub(LIGHT_BLOCK, "", rest, flags=re.M)
    rest = re.sub(r"\"[^\"]*\"|'[^']*'", "", rest)
    rest = re.sub(r"var\(\s*--[\w-]+\s*\)", "", rest)
    for h in re.findall(HEX_RE, rest):
        out.append("%s: raw colour %s outside the token blocks" % (name, h))
    for f in re.findall(COLOUR_FN, rest):
        out.append("%s: raw colour %s() outside the token blocks" % (name, f))
    for prop, value in re.findall(r"([\w-]+)\s*:\s*([^;{}]+)(?=[;}])", rest):
        for word in re.findall(r"[a-zA-Z][\w-]*", value):
            if word.lower() in NAMED:
                out.append("%s: named colour '%s' in %s outside the token blocks" % (name, word, prop))
    return out


for p in files("public", {".css"}):
    for msg in theme_problems(p.read_text(), str(p.relative_to(ROOT))):
        fail(msg)

# --- themes: pre-paint script and the toggle ---------------------------------------------------
# The sign-in page is not a separate document: signIn() renders into index.html's #app, so the
# app shell and the sign-in page share one <head>. Every HTML document in public/ is checked.


def prepaint_problems(page_html, init_js, name="index.html"):
    out = []
    pc = Checker()
    pc.feed(page_html)
    first = pc.scripts[0] if pc.scripts else {}
    if first.get("src") != "/js/theme-init.js" or not first.get("in_head"):
        out.append("%s: the first script must be /js/theme-init.js, in <head>" % name)
    elif any(k in first for k in ("defer", "async", "type")):
        out.append("%s: /js/theme-init.js must be a plain blocking script (no defer/async/module)" % name)
    if not re.search(r"try\s*\{[^}]*localStorage\.getItem\(\"aps-admin-theme\"\)", init_js):
        out.append("theme-init.js: must read localStorage \"aps-admin-theme\" inside try")
    if 'setAttribute("data-theme"' not in init_js:
        out.append("theme-init.js: must set data-theme on <html>")
    return out


init_js = (ROOT / "public/js/theme-init.js").read_text() if (ROOT / "public/js/theme-init.js").exists() else ""
for p in files("public", {".html"}):
    for msg in prepaint_problems(p.read_text(), init_js, str(p.relative_to(ROOT))):
        fail(msg)
theme_js = (ROOT / "public/js/lib/theme.js").read_text()
if not re.search(r"try\s*\{\s*localStorage\.setItem\(THEME_KEY", theme_js):
    fail("lib/theme.js: the localStorage write must be inside try")


class Toggle(HTMLParser):
    """Collects the theme buttons in a render: their attributes, text, and enclosing classes."""

    def __init__(self):
        super().__init__()
        self.buttons, self.stack, self.cur = [], [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "button" and "data-theme-set" in a:
            self.cur = dict(a, text="", parents=[x.get("class", "") for x in self.stack])
            self.buttons.append(self.cur)
        if tag not in VOID:
            self.stack.append(a)

    def handle_endtag(self, tag):
        if tag == "button":
            self.cur = None
        if tag not in VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self.cur is not None:
            self.cur["text"] += data.strip()


def toggle_problems(renders):
    """renders: {name: html}. Each must hold a two-button toggle with aria-pressed and text labels."""
    out = []
    for name, out_html in renders.items():
        t = Toggle()
        t.feed(out_html)
        if len(t.buttons) != 2:
            out.append("%s: needs the two-state theme toggle (found %d buttons)" % (name, len(t.buttons)))
            continue
        for b in t.buttons:
            if b.get("aria-pressed") not in ("true", "false"):
                out.append("%s: theme button %s has no aria-pressed" % (name, b.get("data-theme-set")))
            if not b["text"]:
                out.append("%s: theme button %s has no text label" % (name, b.get("data-theme-set")))
        if [b.get("aria-pressed") for b in t.buttons].count("true") != 1:
            out.append("%s: exactly one theme button must be pressed" % name)
        if name == "frame" and not any("who" in c.split() for c in t.buttons[0]["parents"]):
            out.append("frame: the theme toggle must sit in the header next to sign-out")
    return out


r = subprocess.run(["node", "--input-type=module", "-e", """
import { frame, notAuthorised, signIn } from "./public/js/views/shell.js";
console.log(JSON.stringify({ frame: String(frame({ role: "owner", email: "o@x" }, "bookings")),
  signIn: String(signIn({})), notAuthorised: String(notAuthorised()) }));
"""], cwd=ROOT, capture_output=True, text=True)
if r.returncode:
    fail("shell.js: could not render for the toggle check: %s" % r.stderr.strip()[-300:])
else:
    import json
    for msg in toggle_problems(json.loads(r.stdout)):
        fail(msg)

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
    fail("auth.js: sign-in requests must send create_user: false")
if not re.search(r'type: "email"', auth) or "/verify" not in auth:
    fail("auth.js: sign-in codes must be verified at /verify with type \"email\"")
shell = (ROOT / "public/js/views/shell.js").read_text()
if 'autocomplete="one-time-code"' not in shell or 'inputmode="numeric"' not in shell:
    fail("shell.js: the code field needs inputmode=numeric and autocomplete=one-time-code")
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
