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

# --- Content pane: sections nested by dots -----------------------------------------------------
# Renders the real view on keys with segment names made up on every run (so no hand-written
# label table can pass), then checks the HTML: one tab per first segment, every key in exactly
# one tab at the depth its dots imply, labels derived from segments, search across sections with
# the heading path, the tab in the URL hash, and the publish notice.
import json as _json
import random as _random


def _seg(rng):
    return "%s_%s" % ("".join(rng.choice("bcdfghjklmnpqrstvwxz") for _ in range(5)), "".join(rng.choice("aeiou") for _ in range(3)))


def humanize(seg):
    words = [w for w in re.split(r"[_\-\s]+", seg) if w]
    return " ".join(w[0].upper() + w[1:].lower() for w in words) if words else (seg or "(blank)")


class ContentDom(HTMLParser):
    """Collects fields with their enclosing heading chain, tab links, headings and hits.

    A field is either one line of a group textarea (data-group, its keys in data-keys, in line
    order) or a <label class="content-field"> of its own (a search hit, or a value that cannot
    be one line)."""

    def __init__(self):
        super().__init__()
        self.stack, self.fields, self.tabs, self.heads, self.hits = [], [], [], [], []
        self.groups, self.capture, self.buf = [], None, ""
        self.areas, self.errors, self.blocks = [], {}, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if tag not in VOID:
            self.stack.append((tag, cls, a))
        if tag == "section" and "cgroup" in cls:
            self.groups.append({"path": a.get("data-path"), "depth": int(a.get("data-depth", 0)), "head": None})
        if tag == "div" and "cfields" in cls:
            self.blocks.append({"path": a.get("data-fields"), "chain": [g["path"] for g in self.groups], "areas": 0, "alone": []})
        if tag == "div" and a.get("data-alone") and self.blocks:
            self.blocks[-1]["alone"].append(a["data-alone"])
        if tag == "div" and a.get("data-errors") is not None:
            self.capture, self.buf = ("errors", a["data-errors"]), ""
        if tag == "textarea" and a.get("data-group") is not None:
            self.areas.append({"group": a["data-group"], "keys": _json.loads(a.get("data-keys") or "[]"), "text": "",
                               "chain": [g["path"] for g in self.groups], "invalid": a.get("aria-invalid") == "true"})
            if self.blocks:
                self.blocks[-1]["areas"] += 1
            self.capture, self.buf = "area", ""
        if tag == "label" and "content-field" in cls:
            self.fields.append({"key": a.get("data-key"), "chain": [g["path"] for g in self.groups], "fname": None,
                                "hit": self.hits[-1] if self.hits and self.hits[-1]["open"] else None})
        if tag == "a" and a.get("data-tab") is not None:
            self.tabs.append({"name": a["data-tab"], "href": a.get("href"), "current": a.get("aria-current") == "page", "text": ""})
            self.capture, self.buf = "tab", ""
        if "cg-head" in cls:
            self.capture, self.buf = "head", ""
            self.heads.append({"level": a.get("aria-level"), "role": a.get("role"), "group": self.groups[-1] if self.groups else None})
        if "crumb" in cls and self.capture == "head":
            self.capture = "crumb"
        if "fname" in cls:
            self.capture, self.buf = "fname", ""
        if "hit" in cls and tag == "div":
            self.hits.append({"open": True, "path": None})
        if "hit-path" in cls:
            self.hits[-1]["path"] = a.get("data-hit-path")
            self.capture, self.buf = "hitpath", ""

    def handle_endtag(self, tag):
        if not self.stack:
            return
        t, cls, a = self.stack.pop()
        if self.capture == "crumb" and "crumb" in cls:
            self.capture = "head"
            return
        if self.capture == "area" and t == "textarea":
            area = self.areas[-1]
            area["text"] = self.buf[1:] if self.buf.startswith("\n") else self.buf  # HTML drops one leading newline
            for i, line in enumerate(area["text"].split("\n")):
                key = area["keys"][i] if i < len(area["keys"]) else None
                self.fields.append({"key": key, "chain": area["chain"], "fname": line.split(": ", 1)[0], "hit": None, "line": line})
            self.capture = None
            return
        if isinstance(self.capture, tuple) and t == "div" and a.get("data-errors") == self.capture[1]:
            self.errors[self.capture[1]] = self.buf.strip()
            self.capture = None
            return
        if self.capture == "tab" and t == "a":
            self.tabs[-1]["text"] = self.buf
            self.capture = None
        elif self.capture == "head" and "cg-head" in cls:
            self.heads[-1]["text"] = self.buf.strip()
            if self.groups:
                self.groups[-1]["head"] = self.buf.strip()
            self.capture = None
        elif self.capture == "fname" and "fname" in cls:
            self.fields[-1]["fname"] = self.buf.strip()
            self.capture = None
        elif self.capture == "hitpath" and "hit-path" in cls:
            self.hits[-1]["text"] = self.buf.strip()
            self.capture = None
        if t == "section" and "cgroup" in cls:
            self.groups.pop()
        if t == "div" and "hit" in cls:
            self.hits[-1]["open"] = False

    def handle_data(self, d):
        if self.capture in ("tab", "head", "fname", "hitpath", "area") or isinstance(self.capture, tuple):
            self.buf += d


def content_problems(renders, rows, q_value, q_key):
    """renders: {"tabs": {name: html}, "initial": {name: tabState}, "search": html, "notice": bool}."""
    out = []
    keys = [r["key"] for r in rows]
    firsts = sorted({k.split(".")[0] for k in keys})
    seen = {}
    for name, page in renders["tabs"].items():
        d = ContentDom()
        d.feed(page)
        if sorted(t["name"] for t in d.tabs) != firsts:
            out.append("content: tab row must have exactly one tab per first segment %s, got %s" % (firsts, [t["name"] for t in d.tabs]))
        for t in d.tabs:
            if t["href"] != "#/content/" + t["name"]:
                out.append("content: tab %s must link to #/content/%s (the URL hash), got %s" % (t["name"], t["name"], t["href"]))
            if not t["text"].strip().startswith(humanize(t["name"])):
                out.append("content: tab label for %s must be derived from the segment (%r), got %r" % (t["name"], humanize(t["name"]), t["text"]))
        cur = [t["name"] for t in d.tabs if t["current"]]
        if cur != [name]:
            out.append("content: selecting tab %s must mark it current, got %s" % (name, cur))
        for f in d.fields:
            segs = f["key"].split(".")
            seen.setdefault(f["key"], []).append(name)
            if segs[0] != name:
                out.append("content: %s rendered under tab %s" % (f["key"], name))
            want = [".".join(segs[:i]) for i in range(2, len(segs))]
            if f["chain"] != want:
                out.append("content: %s must sit under headings %s (depth %d), got %s" % (f["key"], want, len(want), f["chain"]))
            if f["fname"] != humanize(segs[-1]):
                out.append("content: field label for %s must be %r (derived), got %r" % (f["key"], humanize(segs[-1]), f["fname"]))
        for h in d.heads:
            g = h["group"]
            if not g:
                continue
            own = humanize(g["path"].split(".")[-1])
            if not h.get("text", "").endswith(own):
                out.append("content: heading for %s must be labelled %r (derived), got %r" % (g["path"], own, h.get("text")))
            if h["role"] != "heading" or h["level"] != str(g["depth"] + 2):
                out.append("content: heading for %s needs role=heading aria-level=%d" % (g["path"], g["depth"] + 2))
        # Fields with no further segments come before the first nested group.
        top = [k for k in keys if k.split(".")[0] == name and len(k.split(".")) <= 2]
        order = [f["key"] for f in d.fields]
        if order[:len(top)] != sorted(top):
            out.append("content: tab %s must list its own fields first (%s), got %s" % (name, sorted(top), order[:len(top)]))
    for k in keys:
        if len(seen.get(k, [])) != 1:
            out.append("content: %s must be reachable from exactly one tab, found in %s" % (k, seen.get(k, [])))
    deep = [k for k in keys if len(k.split(".")) >= 5]
    if not deep:
        out.append("content: guard needs a key five segments deep")
    for name, tab in renders["initial"].items():
        if tab != name:
            out.append("content: #/content/%s must restore tab %s on load, got %r" % (name, name, tab))
    s = ContentDom()
    s.feed(renders["search"])
    page = renders["search"]
    if page.find('data-input="search"') < 0 or page.find('data-input="search"') > page.find('class="subtabs"'):
        out.append("content: the search box must render above the tab row")
    hit_keys = sorted(f["key"] for f in s.fields)
    if hit_keys != sorted([q_value, q_key]):
        out.append("content: search must match by key and by value across all sections: want %s, got %s" % (sorted([q_value, q_key]), hit_keys))
    for f in s.fields:
        segs = f["key"].split(".")
        want = " › ".join(humanize(x) for x in segs[:max(1, len(segs) - 1)])
        if not f["hit"] or f["hit"]["path"] != want or f["hit"].get("text") != want:
            out.append("content: search hit %s must show its section and heading path %r" % (f["key"], want))
    if not renders["notice"]:
        out.append('content: the "Saved edits are not live until you publish." notice is missing')
    return out


_rng = _random.Random()
_A, _B, _C, _D, _E, _F, _T = (_seg(_rng) for _ in range(7))
_keys = ["%s.title" % _A, "%s.%s" % (_A, _B), "%s.%s.%s" % (_A, _C, _D), "%s.%s.%s.%s" % (_A, _C, _D, _E),
         "%s.%s.%s.%s.%s" % (_A, _C, _D, _E, _F), "%s.%s.%s.%s.%s.leaf" % (_A, _C, _D, _E, _F), "%s.%s.zz" % (_A, _C),
         "%s.%s" % (_B, _T), _C, "%s.%s.%s" % (_D.upper(), _E.upper(), _F.upper())]
_rows = [{"key": k, "value": "copy for %d" % i, "updated_at": "2026-01-01T00:00:00Z"} for i, k in enumerate(_keys)]
_rows[3]["value"] = "text with %s inside" % _T.upper()  # matches by value only; _B.<T> matches by key
r = subprocess.run(["node", "--input-type=module", "-e", """
import view from "./public/js/views/content.js";
const [rows, q] = [JSON.parse(process.argv[1]), process.argv[2]];
const ctx = { role: "owner", me: { role: "owner" } };
const at = (sub, extra = {}) => ({ ...view.initial({ ...ctx, sub }), rows, ...extra });
const tabs = {}, initial = {};
for (const n of new Set(rows.map((r) => r.key.split(".")[0]))) {
  // The tab's own link is what lands in the hash; read it back the way the router does.
  const href = [...String(view.render(at(n), ctx)).matchAll(/href="#\\/content\\/([^"]+)" data-tab="([^"]+)"/g)].find((m) => m[2] === n)?.[1];
  const sub = href === undefined ? "" : decodeURIComponent(href);
  initial[n] = view.initial({ ...ctx, sub }).tab;
  tabs[n] = String(view.render(at(sub), { ...ctx, sub }));
}
const search = String(view.render(at("", { q }), ctx));
console.log(JSON.stringify({ tabs, initial, search, notice: search.includes("Saved edits are not live until you publish.") }));
""", _json.dumps(_rows), _T], cwd=ROOT, capture_output=True, text=True)
if r.returncode:
    fail("content.js: could not render for the nesting check: %s" % r.stderr.strip()[-400:])
else:
    for msg in content_problems(_json.loads(r.stdout), _rows, _keys[3], "%s.%s" % (_B, _T)):
        fail(msg)
# --- Content pane: one textarea per group, parsed back key by key ------------------------------
# A group's single-line fields render as ONE textarea of "Label: value" lines in the group's
# order; parsing it back must give exactly the same keys and values (colons, arrows, edge
# spaces). A mistyped, repeated or missing label, or a line with no label, must hold that
# group's save and name the problem, without dropping or inventing a key. A value with a line
# break is its own field. The real handlers run (input:group, then click:save) on a fake pane.

CONTENT_HARNESS = """
import view, { parseGroup } from "./public/js/views/content.js";
const { rows, tab, scenarios, preset } = JSON.parse(process.argv[1]);
const ctx = { role: "owner", me: { role: "owner" }, confirm: () => true };
const fresh = () => ({ ...view.initial({ ...ctx, sub: tab }), rows, edits: { ...preset } });
const out = { render: String(view.render(fresh(), ctx)), runs: {} };
for (const [name, s] of Object.entries(scenarios)) {
  const pane = { state: fresh(), root: { querySelectorAll: () => [] } };
  pane.patch = pane.set = (next) => void (pane.state = { ...pane.state, ...next });
  const run = { sent: null, toasts: [] };
  const c = { ...ctx, toast: (m, bad) => run.toasts.push([m, Boolean(bad)]),
    api: async (_fn, body) => { run.sent = body.changes; const k = Object.keys(body.changes);
      return { updated: k, rows: rows.map((r) => (k.includes(r.key) ? { ...r, value: body.changes[r.key] } : r)) }; } };
  for (const [kind, a, b] of s.steps) {
    if (kind === "edit") {  // a search hit's own field: key a, value b
      const label = { querySelector: () => ({}), classList: { toggle() {} } };
      view.on["input:edit"]({ dataset: { key: a }, value: b, classList: { contains: () => false }, closest: () => label }, pane, c);
      continue;
    }
    const el = { dataset: { group: s.group, keys: JSON.stringify(s.keys) }, value: a, style: {}, scrollHeight: 0, offsetHeight: 0,
      clientHeight: 0, setAttribute() {}, removeAttribute() {}, closest: () => null };
    view.on["input:group"](el, pane, c);
  }
  await view.on["click:save"]({}, pane, c);
  const last = s.steps.filter((x) => x[0] === "group").at(-1)[1];
  run.parsed = parseGroup(last, rows.filter((r) => s.keys.includes(r.key))).values;
  run.after = String(view.render(pane.state, c));
  out.runs[name] = run;
}
console.log(JSON.stringify(out));
"""


def content_run(rows, tab, scenarios=None, preset=None):
    r = subprocess.run(["node", "--input-type=module", "-e", CONTENT_HARNESS,
                        _json.dumps({"rows": rows, "tab": tab, "scenarios": scenarios or {}, "preset": preset or {}})],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        return None, r.stderr.strip()[-400:]
    return _json.loads(r.stdout), None


def group_problems(rows, tab, group, multi, other):
    """rows: one tab; `group` holds N single-line fields plus the `multi` key (a line break);
    `other` is a key in another group with an unsaved edit that must still save."""
    out = []
    inline = sorted((r for r in rows if r["key"].rsplit(".", 1)[0] == group and r["key"] != multi), key=lambda r: r["key"])
    want = ["%s: %s" % (humanize(r["key"].split(".")[-1]), r["value"]) for r in inline]
    keys = [r["key"] for r in inline]
    lines = list(want)
    edited = {keys[0]: inline[0]["value"] + " (edited: yes)", keys[2]: " new → value: here "}
    two = list(lines)
    two[0], two[2] = "%s: %s" % (want[0].split(": ", 1)[0], edited[keys[0]]), "%s: %s" % (want[2].split(": ", 1)[0], edited[keys[2]])
    first, second = want[0].split(": ", 1)[0], want[1].split(": ", 1)[0]
    typo = "Xq" + first
    bad = {
        "mistyped": ([typo + ": " + inline[0]["value"]] + lines[1:], typo),
        "duplicated": (lines + [lines[1]], second),
        "missing": (lines[:1] + lines[2:], second),
        "no label": (lines + ["just words here"], "just words here"),
    }
    g = lambda ls: ["group", "\n".join(ls)]
    scen = {"roundtrip": {"steps": [g(lines)]}, "two edits": {"steps": [g(two)]},
            "two edits then reverted": {"steps": [g(two), g(lines)]}}
    for name, (ls, _) in bad.items():
        scen[name] = {"steps": [g(ls)]}
    # Each layer alone: a valid edit made invalid must not save; a search-hit edit to a key in
    # an invalid group must not save either.
    scen["valid then mistyped"] = {"steps": [g(two), g(bad["mistyped"][0])]}
    scen["mistyped, then a hit edit"] = {"steps": [g(bad["mistyped"][0]), ["edit", keys[1], "edited from search"]]}
    for v in scen.values():
        v.update(group=group, keys=keys)
    other_value = "other group's edit"
    res, err = content_run(rows, tab, scen, {other: other_value})
    if err:
        return ["content: could not render/run the group textarea: %s" % err]
    d = ContentDom()
    d.feed(res["render"])
    areas = [a for a in d.areas if a["group"] == group]
    block = [b for b in d.blocks if b["path"] == group]
    if len(areas) != 1 or (block and block[0]["areas"] != 1):
        out.append("content: group %s must render ONE textarea for its %d single-line fields, found %d" % (group, len(inline), len(areas)))
    elif areas[0]["text"].split("\n") != want or areas[0]["keys"] != keys:
        out.append("content: group %s textarea must be %d lines 'Label: value' in the group's order:\n      want %r\n      got  %r"
                   % (group, len(want), want, areas[0]["text"].split("\n")))
    if any(multi in a["keys"] or multi.split(".")[-1] in a["text"] for a in d.areas) or not block or multi not in block[0]["alone"] \
            or not any(f["key"] == multi and f["fname"] == humanize(multi.split(".")[-1]) for f in d.fields):
        out.append("content: %s has a line break, so it must render as its own field below the group, not in the textarea" % multi)
    runs = res["runs"]
    orig = {r["key"]: r["value"] for r in inline}
    rt = runs["roundtrip"]
    if rt["parsed"] != orig:
        out.append("content: parsing the rendered textarea must give back exactly the %d keys and values:\n      want %r\n      got  %r" % (len(orig), orig, rt["parsed"]))
    if rt["sent"] not in (None, {other: other_value}):
        out.append("content: an unchanged group must save nothing of its own, sent %r" % rt["sent"])
    te = runs["two edits"]
    if te["sent"] != dict(edited, **{other: other_value}):
        out.append("content: editing two lines must save exactly those two keys (and the other group's edit), sent %r" % te["sent"])
    if runs["two edits then reverted"]["sent"] != {other: other_value}:
        out.append("content: lines edited then typed back to their saved values must save nothing, sent %r" % runs["two edits then reverted"]["sent"])
    for name, (_, label) in list(bad.items()) + [("valid then mistyped", (None, typo)), ("mistyped, then a hit edit", (None, typo))]:
        run = runs[name]
        sent = run["sent"] or {}
        if any(k in sent for k in keys) or set(sent) - set(r["key"] for r in rows):
            out.append("content: a %s label must hold group %s's save (no key dropped or created), sent %r" % (name, group, sent))
        if sent != {other: other_value}:
            out.append("content: a %s label in one group must not hold other groups' saves, sent %r" % (name, sent))
        a = ContentDom()
        a.feed(run["after"])
        msg = a.errors.get(group, "")
        if label not in msg:
            out.append("content: a %s label must show an error naming %r above group %s, got %r" % (name, label, group, msg))
        kept = [x for x in a.areas if x["group"] == group]
        if not kept or not kept[0]["invalid"]:
            out.append("content: after a refused save, group %s must keep the typed text, marked invalid" % group)
        if not any(bad for _, bad in run["toasts"]):
            out.append("content: a save with a %s label must say a group was not saved" % name)
    return out


_rng2 = _random.Random()
_G = "%s.%s" % (_seg(_rng2), _seg(_rng2))
_tab = _G.split(".")[0]
_vals = ["Read it", "WHICH KIND IS YOURS?: pick one", "Bring it to an hour →", "  padded both ends  ", "10", "a:b:c → d: "]
_lead = [_seg(_rng2) for _ in _vals]
_grows = [{"key": "%s.%s" % (_G, l), "value": v, "updated_at": "2026-01-0%dT00:00:00Z" % (i + 1)} for i, (l, v) in enumerate(zip(_lead, _vals))]
_multi = "%s.%s" % (_G, _seg(_rng2))
_other = "%s.%s" % (_tab, _seg(_rng2))
_grows += [{"key": _multi, "value": "first line\n%s: looks like a label" % humanize(_lead[0]), "updated_at": "2026-01-01T00:00:00Z"},
           {"key": _other, "value": "top level", "updated_at": "2026-01-01T00:00:00Z"}]
for msg in group_problems(_grows, _tab, _G, _multi, _other):
    fail(msg)


# --- Content pane: website order (sort_order), key order without it --------------------------------


def order_problems():
    """Tabs, groups and fields follow sort_order (nulls last, key breaks ties); a group sits at
    the lowest sort_order under it. null everywhere, or no column at all, is plain key order."""
    out = []
    # c has no fields of its own: its place comes only from c.h.k, two levels down.
    base = [("b.z", 1), ("b.g2.y", 2), ("b.g2.a", 3), ("b.g1.x", 4), ("b.m", None), ("b.c", None), ("a.q", 5), ("a.p", None), ("c.h.k", 0)]
    variants = {
        "sort_order": ([dict(key=k, value="v", updated_at="2026-01-01T00:00:00Z", sort_order=o) for k, o in base],
                       ["c", "b", "a"], ["b.z", "b.c", "b.m"], ["b.g2", "b.g1"], ["b.g2.y", "b.g2.a"]),
        "null": ([dict(key=k, value="v", updated_at="2026-01-01T00:00:00Z", sort_order=None) for k, _ in base],
                 ["a", "b", "c"], ["b.c", "b.m", "b.z"], ["b.g1", "b.g2"], ["b.g2.a", "b.g2.y"]),
        "absent": ([dict(key=k, value="v", updated_at="2026-01-01T00:00:00Z") for k, _ in base],
                   ["a", "b", "c"], ["b.c", "b.m", "b.z"], ["b.g1", "b.g2"], ["b.g2.a", "b.g2.y"]),
    }
    for name, (rows, tabs, own, groups, g2) in variants.items():
        res, err = content_run(rows, "b")
        if err:
            out.append("content: with sort_order %s the pane must still render: %s" % (name, err))
            continue
        d = ContentDom()
        d.feed(res["render"])
        got = {
            "tabs": [t["name"] for t in d.tabs],
            "own fields": next((a["keys"] for a in d.areas if a["group"] == "b"), []),
            "groups": [g["path"] for g in d.blocks if g["path"].count(".") == 1],
            "fields in b.g2": next((a["keys"] for a in d.areas if a["group"] == "b.g2"), []),
        }
        for what, want in zip(got, (tabs, own, groups, g2)):
            if got[what] != want:
                out.append("content: with sort_order %s, %s must be ordered %s, got %s" % (name, what, want, got[what]))
    fn = (ROOT / "supabase/functions/admin-content/handler.ts").read_text()
    if "sort_order" in re.sub(r"//.*", "", fn):
        out.append("admin-content: must not name sort_order in a query — an unmigrated database has no such column")
    return out


for msg in order_problems():
    fail(msg)


# --- Navigation weight -----------------------------------------------------------------------------


def nav_problems(css_src, page_html):
    """Both tab rows (.tabs, .subtabs) are set at 600 or heavier, Plex Mono 600 is loaded, and the
    active tab differs from the rest by colour and an underline, not by weight alone."""
    out = []
    src = re.sub(r"/\*.*?\*/", "", css_src, flags=re.S)
    rule = lambda sel: " ".join(re.findall(r"(?:^|\})\s*" + re.escape(sel) + r"\s*\{([^}]*)\}", src))
    prop = lambda body, name: (re.findall(r"(?:^|;|\s)" + name + r"\s*:\s*([^;]+)", body) or [None])[-1]
    for row in (".tabs a", ".subtabs a"):
        w = prop(rule(row), "font-weight")
        if not w or not w.strip().isdigit() or int(w) < 600:
            out.append("admin.css: %s must be font-weight 600 or heavier, got %s" % (row, w))
        if prop(rule(row), "letter-spacing") != ".18em" or prop(rule(row), "text-transform") != "uppercase":
            out.append("admin.css: %s must keep .18em tracking and uppercase" % row)
        act = rule(row + "[aria-current=page]")
        if not prop(act, "color") or prop(act, "color") == prop(rule(row), "color") or not prop(act, "border-bottom-color"):
            out.append("admin.css: the active %s must differ by colour and underline, not weight alone" % row)
        aw = prop(act, "font-weight")
        if aw and int(aw) < 600:
            out.append("admin.css: the active %s must not be lighter than the rest" % row)
    fonts = re.search(r"IBM\+Plex\+Mono:wght@([\d;]+)", page_html)
    if not fonts or "600" not in fonts.group(1).split(";"):
        out.append("index.html: IBM Plex Mono 600 must be loaded for the tab rows (else the browser fakes bold)")
    return out


for msg in nav_problems((ROOT / "public/css/admin.css").read_text(), (ROOT / "public/index.html").read_text()):
    fail(msg)

app_js = (ROOT / "public/js/app.js").read_text()
if "mounted.pane.route(sub)" not in app_js or "decodeURIComponent(rest" not in app_js or "sub: id === wanted ? sub" not in app_js:
    fail("app.js: #/<pane>/<sub> must reach the pane (initial ctx.sub, and pane.route on a hash change without remounting)")
if not re.search(r"route\(sub, pane\)\s*\{[^}]*tab: sub", (ROOT / "public/js/views/content.js").read_text()):
    fail("content.js: a hash change must switch the section tab (route(sub, pane) → tab: sub)")


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
