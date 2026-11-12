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
    """Both tab rows (.tabs, .subtabs) are set at 600 or heavier, Plex Mono 600 is loaded for the
    main row, and the active tab differs from the rest by colour and an underline, not by weight
    alone. Only the main row is uppercase mono; the Content section tabs are set in Inter."""
    out = []
    src = re.sub(r"/\*.*?\*/", "", css_src, flags=re.S)
    rule = lambda sel: " ".join(re.findall(r"(?:^|\})\s*" + re.escape(sel) + r"\s*\{([^}]*)\}", src))
    prop = lambda body, name: (re.findall(r"(?:^|;|\s)" + name + r"\s*:\s*([^;]+)", body) or [None])[-1]
    for row in (".tabs a", ".subtabs a"):
        w = prop(rule(row), "font-weight")
        if not w or not w.strip().isdigit() or int(w) < 600:
            out.append("admin.css: %s must be font-weight 600 or heavier, got %s" % (row, w))
        if row == ".tabs a" and (prop(rule(row), "letter-spacing") != ".18em" or prop(rule(row), "text-transform") != "uppercase"):
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


# --- Content pane: type hierarchy --------------------------------------------------------------
# Section tabs and group headings are ordinary words in Inter, not uppercase monospace; the tabs
# outrank the headings by size and weight; the field keys stay monospace because they are literal.

def css_rules(css_src):
    """[(selector, body)] for every innermost rule, one entry per comma-separated selector."""
    src = re.sub(r"/\*.*?\*/", "", css_src, flags=re.S)
    out = []
    for sels, body in re.findall(r"([^{}]+)\{([^{}]*)\}", src):
        for sel in sels.split(","):
            out.append((" ".join(sel.split()), body))
    return out


def _decl(body, name):
    return (re.findall(r"(?:^|;|\s)" + name + r"\s*:\s*([^;]+)", body) or [None])[-1]


def _px(v):
    m = re.fullmatch(r"\s*([\d.]+)px\s*", v or "")
    return float(m.group(1)) if m else None


def content_type_problems(css_src):
    out = []
    rules = css_rules(css_src)
    MONO = re.compile(r"--mono|monospace|Plex Mono", re.I)
    labelled = [(s, b) for s, b in rules if s.startswith(".subtabs") or "cg-head" in s]
    for sel, body in labelled:
        for name in ("font-family", "font"):
            v = _decl(body, name)
            if v and MONO.search(v):
                out.append("admin.css: %s must not be monospace (%s: %s)" % (sel, name, v.strip()))
        if (_decl(body, "text-transform") or "").strip() == "uppercase":
            out.append("admin.css: %s must not be uppercase-transformed" % sel)
    tab = " ".join(b for s, b in rules if s == ".subtabs a")
    if "sans" not in (_decl(tab, "font-family") or ""):
        out.append("admin.css: .subtabs a must set font-family: var(--sans)")
    head = " ".join(b for s, b in rules if s == ".cg-head")
    if "sans" not in (_decl(head, "font-family") or ""):
        out.append("admin.css: .cg-head must set font-family: var(--sans)")
    tsize, tweight = _px(_decl(tab, "font-size")), int((_decl(tab, "font-weight") or "400").strip())
    if tsize is None:
        out.append("admin.css: .subtabs a needs a px font-size to rank against the group headings")
    for sel, body in [(s, b) for s, b in rules if s.endswith(".cg-head")]:
        size = _px(_decl(body, "font-size"))
        if sel == ".cg-head" and size is None:
            out.append("admin.css: .cg-head needs a px font-size")
        if tsize is not None and size is not None and size >= tsize:
            out.append("admin.css: %s (%gpx) must be smaller than the section tabs (%gpx)" % (sel, size, tsize))
        w = _decl(body, "font-weight")
        if (w or sel == ".cg-head") and int((w or "400").strip()) >= tweight:
            out.append("admin.css: %s (weight %s) must be lighter than the section tabs (%d)" % (sel, (w or "400").strip(), tweight))
    for sel in (".content-field .fkey", ".fkeys"):
        body = " ".join(b for s, b in rules if s == sel)
        if "--mono" not in (_decl(body, "font-family") or ""):
            out.append("admin.css: %s (literal field keys) must stay font-family: var(--mono)" % sel)
    return out


for msg in content_type_problems((ROOT / "public/css/admin.css").read_text()):
    fail(msg)

# --- Traffic pane: CUSTOM range ----------------------------------------------------------------
# Drives the real view's handlers on a fake pane with a counting api: CUSTOM reveals exactly the
# FROM/TO fields Audit and Signals render (the presets reveal none); an inverted or future range
# is refused inline with no fetch; the range round-trips through the hash the way app.js reads it;
# FROM/TO are sent as IST midnights. Then the real admin-traffic handler, on the mock DB, must
# refuse UTC midnights and an inverted range and give one IST day per bar.

TRAFFIC_HARNESS = """
import view from "./public/js/views/traffic.js";
import audit from "./public/js/views/audit.js";
import signals from "./public/js/views/signals.js";
import { call, fresh } from "./tests/helpers.ts";
const { scenarios, server } = JSON.parse(process.argv[1]);
const summary = (body) => ({ days: body.days ?? 3, since: "x", until: null, views: 7, previous_views: 5, sessions: 3, ai: [],
  daily: [{ date: "2026-01-01", count: 1 }], referrers: [], countries: [], campaigns: [], paths: [] });
const run = async (s) => {
  const out = { calls: [], hashes: [], initialCalls: 0 };
  const ctx = { role: "team", me: { role: "team" }, sub: s.sub, toast() {}, navigate: (h) => out.hashes.push(h),
    api: async (_fn, body) => (out.calls.push(body), summary(body)) };
  const pane = { state: view.initial(ctx) };
  pane.set = (next) => void (pane.state = { ...pane.state, ...next });
  pane.reload = async () => void (pane.state = { ...pane.state, ...(await view.load(ctx, pane.state)) });
  await pane.reload();  // the mount
  out.initialCalls = out.calls.length;
  for (const [kind, a, b] of s.steps) {
    if (kind === "days") await view.on["click:days"]({ dataset: { days: String(a) } }, pane, ctx);
    if (kind === "custom") await view.on["click:custom"]({}, pane, ctx);
    if (kind === "route") await view.route(a, pane, ctx);
    if (kind === "submit") await view.on["submit:range"]({ elements: { from: { value: a }, to: { value: b } } }, pane, ctx);
  }
  out.state = { mode: pane.state.mode, from: pane.state.from, to: pane.state.to, error: pane.state.error };
  try {
    out.html = String(view.render(pane.state, ctx));
  } catch (e) {
    out.html = `render failed: ${e.message}`;
  }
  return out;
};
const out = { runs: {}, others: {}, server: {} };
for (const [name, s] of Object.entries(scenarios)) out.runs[name] = await run(s);
const f = { from: "2026-01-01", to: "2026-01-02" };
out.others.audit = String(audit.render({ filters: f, families: [], rows: [], total: 0 }, { role: "owner" }));
out.others.signals = String(signals.render({ filters: f, rows: [], total: 0, facets: { all: 0, converted: 0, verdicts: [], countries: [] } }, {}));
for (const [name, body] of Object.entries(server)) {
  const r = await call(fresh(), "admin-traffic", "team", { action: "summary", ...body });
  out.server[name] = { status: r.status, daily: (r.json.daily ?? []).map((d) => d.date) };
}
console.log(JSON.stringify(out));
"""

DATE_INPUT_RE = r'<input type="date"[^>]*>'
FROMTO_RE = r'<label class="field"><span class="label">From</span><input type="date" name="from"[^>]*></label>\s*<label class="field"><span class="label">To</span><input type="date" name="to"[^>]*></label>'


def traffic_hash_sub(h):
    """What app.js hands the pane for a hash: the part after #/traffic/, URI-decoded."""
    from urllib.parse import unquote
    parts = re.sub(r"^#/?", "", h).split("/")
    return parts[0], unquote("/".join(parts[1:]))


def traffic_problems(res):
    out = []
    runs = res["runs"]
    blank = lambda s: re.sub(r'value="[^"]*"', 'value=""', s)
    # 1. CUSTOM reveals the two date inputs; the presets do not.
    for name in ("default", "preset 7", "preset 30", "preset 90", "custom then 7"):
        n = len(re.findall(DATE_INPUT_RE, runs[name]["html"]))
        if n:
            out.append("traffic: %s must show no date inputs, found %d" % (name, n))
    for name in ("custom", "custom from hash"):
        h = runs[name]["html"]
        inputs = re.findall(DATE_INPUT_RE, h)
        if len(inputs) != 2 or not re.search(FROMTO_RE, h):
            out.append("traffic: %s must reveal exactly the FROM and TO date inputs, found %d" % (name, len(inputs)))
            continue
        mine = blank(re.search(FROMTO_RE, h).group(0))
        for other in ("audit", "signals"):
            theirs = re.search(FROMTO_RE, res["others"][other])
            if not theirs or blank(theirs.group(0)) != mine:
                out.append("traffic: the FROM/TO markup must be the one %s uses" % other)
    if 'data-click="custom" aria-pressed="true"' not in runs["custom"]["html"]:
        out.append("traffic: the CUSTOM button must show as pressed when chosen")
    # 2. An inverted or future range is refused inline and triggers no fetch.
    for name in ("inverted", "future", "starts in the future", "inverted from hash", "future from hash"):
        r = runs[name]
        before = r["initialCalls"] if "hash" not in name else 0
        if len(r["calls"]) != before:
            out.append("traffic: %s range must not fetch (made %d call(s))" % (name, len(r["calls"]) - before))
        alert = re.search(r'role="alert"[^>]*>([^<]+)<', r["html"])
        if not r["state"]["error"] or not alert or not alert.group(1).strip():
            out.append("traffic: %s range must be refused inline with a plain message" % name)
        if 'class="stats"' in r["html"]:
            out.append("traffic: %s range must not show numbers" % name)
        if "hash" not in name and any("custom/" in h for h in r["hashes"]):
            out.append("traffic: a refused range must not be written to the hash")
    ok = runs["valid"]
    if len(ok["calls"]) != ok["initialCalls"] + 1 or ok["state"]["error"] or 'class="stats"' not in ok["html"]:
        out.append("traffic: a valid custom range must load exactly once and show its numbers")
    # 3. The range round-trips through the URL hash (and the presets keep theirs).
    for name, want in (("valid", ("custom", "2026-03-10", "2026-03-12")), ("preset 7", (7, "", "")), ("preset 90", (90, "", ""))):
        r = runs[name]
        if not r["hashes"]:
            out.append("traffic: %s must be written to the hash" % name)
            continue
        pane, sub = traffic_hash_sub(r["hashes"][-1])
        back = runs.get("reopen " + name)
        if pane != "traffic" or not back or back["sub"] != sub:
            out.append("traffic: %s hash %s does not reopen the Traffic pane (sub %r)" % (name, r["hashes"][-1], sub))
            continue
        got = (back["state"]["mode"], back["state"]["from"], back["state"]["to"])
        if got != want or back["calls"][:1] != r["calls"][-1:]:
            out.append("traffic: reopening %s from its hash gives %s / %s, not %s / %s" % (name, got, back["calls"][:1], want, r["calls"][-1:]))
    d = runs["default"]
    if d["state"]["mode"] != 30 or d["calls"] != [{"action": "summary", "days": 30}]:
        out.append("traffic: the default on first load must stay 30 days, got %s %s" % (d["state"]["mode"], d["calls"]))
    r = runs["route back"]
    if r["state"]["mode"] != "custom" or r["calls"][-1:] != ok["calls"][-1:]:
        out.append("traffic: a hash change to a custom range must load that range")
    # 4. IST day boundaries, not UTC.
    want = {"action": "summary", "from": "2026-03-09T18:30:00.000Z", "to": "2026-03-12T18:30:00.000Z"}
    if ok["calls"][-1:] != [want]:
        out.append("traffic: FROM 2026-03-10 TO 2026-03-12 must be sent as IST midnights %s, got %s" % (want, ok["calls"][-1:]))
    s = res["server"]
    if s["ist"]["status"] != 200 or s["ist"]["daily"] != ["2026-10-10", "2026-10-11", "2026-10-12"]:
        out.append("admin-traffic: an IST range must give one bar per IST day, got %s" % s["ist"])
    for name in ("utc", "inverted", "future"):
        if s[name]["status"] != 400:
            out.append("admin-traffic: a %s range must be refused (400), got %d" % (name, s[name]["status"]))
    for name in ("days 7", "days 30", "days 90"):
        if s[name]["status"] != 200 or len(s[name]["daily"]) != int(name.split()[1]):
            out.append("admin-traffic: the %s preset must still work" % name)
    if any("Days are IST calendar days." not in r["html"] for r in runs.values()):
        out.append('traffic: "Days are IST calendar days." must stay visible for every option')
    return out


def traffic_run(today):
    from datetime import date, timedelta
    t = date.fromisoformat(today)
    iso = lambda d: (t + timedelta(days=d)).isoformat()
    ist = lambda d: "%sT00:00:00+05:30" % d
    scenarios = {
        "default": {"sub": "", "steps": []},
        "preset 7": {"sub": "", "steps": [["days", 7]]},
        "preset 30": {"sub": "7", "steps": [["days", 30]]},
        "preset 90": {"sub": "", "steps": [["days", 90]]},
        "custom": {"sub": "", "steps": [["custom"]]},
        "custom then 7": {"sub": "", "steps": [["custom"], ["submit", "2026-03-10", "2026-03-12"], ["days", 7]]},
        "custom from hash": {"sub": "custom", "steps": []},
        "valid": {"sub": "", "steps": [["custom"], ["submit", "2026-03-10", "2026-03-12"]]},
        "inverted": {"sub": "", "steps": [["custom"], ["submit", "2026-03-12", "2026-03-10"]]},
        "future": {"sub": "", "steps": [["custom"], ["submit", iso(-3), iso(2)]]},
        "starts in the future": {"sub": "", "steps": [["custom"], ["submit", iso(1), iso(4)]]},
        "inverted from hash": {"sub": "custom/2026-03-12/2026-03-10", "steps": []},
        "future from hash": {"sub": "custom/%s/%s" % (iso(-1), iso(3)), "steps": []},
        "route back": {"sub": "", "steps": [["route", "custom/2026-03-10/2026-03-12"]]},
    }
    server = {
        "ist": {"from": ist("2026-10-10"), "to": ist("2026-10-13")},
        "utc": {"from": "2026-10-10T00:00:00Z", "to": "2026-10-13T00:00:00Z"},
        "inverted": {"from": ist("2026-10-13"), "to": ist("2026-10-10")},
        "future": {"from": ist("2026-10-18"), "to": ist("2026-10-25")},  # the mock's today is 2026-10-20
        "days 7": {"days": 7}, "days 30": {"days": 30}, "days 90": {"days": 90},
    }

    def node(sc):
        r = subprocess.run(["node", "--input-type=module", "-e", TRAFFIC_HARNESS, _json.dumps({"scenarios": sc, "server": server})],
                           cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            return None, r.stderr.strip()[-400:]
        return _json.loads(r.stdout), None

    res, err = node(scenarios)
    if err:
        return None, err
    # Reopen each written hash as a fresh page load would: the sub-path becomes ctx.sub.
    reopen = {}
    for name in ("valid", "preset 7", "preset 90"):
        if res["runs"][name]["hashes"]:
            reopen["reopen " + name] = {"sub": traffic_hash_sub(res["runs"][name]["hashes"][-1])[1], "steps": []}
    if reopen:
        more, err = node(reopen)
        if err:
            return None, err
        for k, v in more["runs"].items():
            res["runs"][k] = dict(v, sub=reopen[k]["sub"])
    return res, None


def _ist_today():
    from datetime import datetime, timedelta, timezone
    return datetime.now(timezone(timedelta(hours=5, minutes=30))).date().isoformat()


_res, _err = traffic_run(_ist_today())
if _err:
    fail("traffic.js: could not run the custom range check: %s" % _err)
else:
    for msg in traffic_problems(_res):
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

# --- environment variables: one manifest, read only through the helpers ---------------------
# supabase/functions/_shared/config.ts lists every variable; scripts/env_report.py reads that
# list. These names are live in production — a rename here breaks a deployed function, so the
# manifest must match this set exactly (a new variable is added to both, deliberately).
LIVE_ENV = {
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "MAIL_FROM", "GITHUB_PAT", "GITHUB_SITE_REPO",
    "ADMIN_ORIGIN", "SITE_ORIGIN", "OWNER_EMAIL", "BRIEF_BUCKET", "ALLOWED_EMAIL_DOMAIN",
}
ENV_HELPER_RE = r"\b(requiredEnv|optionalEnv|envOr)\(\s*[\w.]+,\s*\"([A-Z][A-Z0-9_]*)\""


def env_problems():
    import importlib.util
    out = []
    spec = importlib.util.spec_from_file_location("env_report", ROOT / "scripts/env_report.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    try:
        entries = mod.manifest()
    except SystemExit as e:
        return ["env_report.py cannot read the manifest: %s" % e]
    names = {e[0] for e in entries}
    if len(names) != len(entries):
        out.append("config.ts: a variable is listed twice")
    if names != LIVE_ENV:
        out.append("config.ts: ENV_VARS must hold exactly the live names; missing %s, unexpected %s"
                   % (sorted(LIVE_ENV - names), sorted(names - LIVE_ENV)))
    for name, required, provided, breaks in entries:
        if not breaks.strip():
            out.append("config.ts: %s must say what breaks when it is unset" % name)
    required = {e[0] for e in entries if e[1]}
    used = {}
    for p in files("supabase/functions", {".ts", ".js"}):
        rel = str(p.relative_to(ROOT))
        src = re.sub(r"^\s*//.*$", "", p.read_text(), flags=re.M)
        if p.name == "config.ts" and p.parent.name == "_shared":
            continue
        if re.search(r"\benv\(|Deno\.env\.(?!get\(key\))", src):
            out.append("%s: reads an environment variable directly — use requiredEnv / optionalEnv / envOr" % rel)
        if "Deno.env" in src and not (p.name == "index.ts" and "prodDeps((key) => Deno.env.get(key))" in src):
            out.append("%s: Deno.env is only handed to prodDeps in index.ts" % rel)
        for helper, name in re.findall(ENV_HELPER_RE, src):
            used.setdefault(name, set()).add(helper)
            if name not in names:
                out.append("%s: %s(%s) is not in the manifest" % (rel, helper, name))
            elif name in required and helper != "requiredEnv":
                out.append("%s: %s is required — read it with requiredEnv, not %s" % (rel, name, helper))
            elif name not in required and helper == "requiredEnv":
                out.append("%s: %s is optional — requiredEnv would fail the request" % (rel, name))
    for name in sorted(names - set(used)):
        out.append("config.ts: %s is listed but no function reads it" % name)

    # The helpers themselves, and the TS list agreeing with what env_report parsed.
    r = subprocess.run(["node", "--input-type=module", "-e", ENV_HARNESS], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        return out + ["config.ts: helper harness failed: %s" % r.stderr.strip()[-300:]]
    h = _json.loads(r.stdout)
    if h["names"] != [e[0] for e in entries] or h["required"] != sorted(required):
        out.append("env_report.py parses a different list from config.ts ENV_VARS")
    if h["required_throw"] != [500, "misconfigured", "MAIL_FROM is not set"] or h["required_log"] != ["config: MAIL_FROM is not set"]:
        out.append("requiredEnv must log \"config: NAME is not set\" and throw a 500 misconfigured, got %s %s" % (h["required_throw"], h["required_log"]))
    if h["optional"] != [None, "fallback"] or h["optional_log"] != ["config: OWNER_EMAIL is not set", "config: SITE_ORIGIN is not set"]:
        out.append("optionalEnv / envOr must log the name once and carry on, got %s %s" % (h["optional"], h["optional_log"]))
    if h["boot"] != "ok":
        out.append("prodDeps must boot with nothing set (it logs instead): %s" % h["boot"])

    # The report: names only, never values; exit 1 only for a missing required variable.
    secret = "s3cr3t-VALUE-%d"
    full = {n: secret % i for i, n in enumerate(sorted(LIVE_ENV))}

    def report(env):
        return subprocess.run([sys.executable, "scripts/env_report.py"], cwd=ROOT, capture_output=True, text=True,
                              env={"PATH": "/usr/bin:/bin", **env})
    cases = {
        "all set": (full, 0),
        "MAIL_FROM unset": ({k: v for k, v in full.items() if k != "MAIL_FROM"}, 1),
        "MAIL_FROM blank": (dict(full, MAIL_FROM="  "), 1),
        "optional unset": ({k: v for k, v in full.items() if k in required}, 0),
        "platform-provided absent": ({k: v for k, v in full.items() if not k.startswith("SUPABASE_")}, 0),
    }
    for label, (env, code) in cases.items():
        r = report(env)
        if r.returncode != code:
            out.append("env_report.py: %s must exit %d, got %d" % (label, code, r.returncode))
        if "s3cr3t-VALUE" in r.stdout + r.stderr:
            out.append("env_report.py: %s printed a value — names only" % label)
        if any(n not in r.stdout for n in LIVE_ENV):
            out.append("env_report.py: %s must list every variable" % label)
        if code and not re.search(r"MAIL_FROM\s+MISSING", r.stdout):
            out.append("env_report.py: %s must mark MAIL_FROM as MISSING" % label)
    return out


ENV_HARNESS = """
import { ENV_VARS, envOr, optionalEnv, requiredEnv } from "./supabase/functions/_shared/config.ts";
import { prodDeps } from "./supabase/functions/_shared/adapters.ts";
const logs = [];
console.warn = (...a) => logs.push(a.join(" "));
const out = { names: ENV_VARS.map((v) => v.name), required: ENV_VARS.filter((v) => v.required).map((v) => v.name).sort() };
const empty = (k) => ({ SITE_ORIGIN: " " })[k];
try { requiredEnv(empty, "MAIL_FROM"); out.required_throw = "did not throw"; } catch (e) { out.required_throw = [e.status, e.code, e.message]; }
out.required_log = logs.splice(0);
out.optional = [optionalEnv(empty, "OWNER_EMAIL") ?? null, envOr(empty, "SITE_ORIGIN", "fallback")];
optionalEnv(empty, "OWNER_EMAIL");
out.optional_log = logs.splice(0);
try { prodDeps(() => undefined); out.boot = "ok"; } catch (e) { out.boot = String(e); }
console.log(JSON.stringify(out));
"""

for msg in env_problems():
    fail(msg)


# --- Bookings: grouped, action first, date order within each group -------------------------------
# Renders the real view on shuffled rows. The two groups that need action come first (asked for
# other times, then paid with no time), then upcoming (soonest first), past (most recent first),
# then the rest (newest first). The filters still apply before grouping.
BOOKINGS_HARNESS = """
import view from "./public/js/views/bookings.js";
const H = 3_600_000, now = Date.parse("2026-11-11T06:00:00Z");
const at = (h) => new Date(now + h * H).toISOString();
const row = (name, o) => ({ id: name, payer_name: name, payer_email: name + "@x.co", status: "captured", scheduled: false,
  pending_request: false, flagged: false, heard_from: "", created_at: at(-10), ...o });
const rows = [
  row("Past-old", { scheduled: true, slot_start: at(-300), created_at: at(-400) }),
  row("Unsched-new", { created_at: at(-2) }),
  row("Up-later", { scheduled: true, slot_start: at(90), created_at: at(-5) }),
  row("Asked-new", { pending_request: true, created_at: at(-3) }),
  row("Refunded", { status: "refunded", created_at: at(-1) }),
  row("Past-recent", { scheduled: true, slot_start: at(-20), created_at: at(-50) }),
  row("Unsched-old", { created_at: at(-60), flagged: true }),
  row("Up-soon", { scheduled: true, slot_start: at(20), created_at: at(-1) }),
  row("Asked-old", { pending_request: true, created_at: at(-80), flagged: true }),
  row("Created", { status: "created", created_at: at(-30) }),
  row("Scheduled-asked", { scheduled: true, pending_request: true, slot_start: at(40), created_at: at(-9) }),
];
const stats = { total: 0, upcoming: 0, paid_not_scheduled: 0, brief_missing: 0 };
const render = (role, filters = {}) => String(view.render({ rows: [...rows], stats, now: new Date(now).toISOString(), filters, open: {} }, { role }));
console.log(JSON.stringify({ admin: render("admin"), team: render("team"), scheduled: render("owner", { sched: "scheduled" }), q: render("admin", { q: "asked-" }) }));
"""

BOOKINGS_WANT = [
    ("requested", ["Asked-old", "Asked-new"]),
    ("unscheduled", ["Unsched-old", "Unsched-new"]),
    ("upcoming", ["Up-soon", "Scheduled-asked", "Up-later"]),
    ("past", ["Past-recent", "Past-old"]),
    ("other", ["Refunded", "Created"]),
]


def booking_groups(page):
    out = []
    for gid, body in re.findall(r'<tbody data-group="(\w+)">(.*?)</tbody>', page, re.S):
        head = re.search(r'<tr class="group-head( action)?">', body)
        names = re.findall(r'<td data-label="Name">([^<]+)</td>', body)
        out.append((gid, names, bool(head and head.group(1))))
    return out


def bookings_problems(res):
    out = []
    for role in ("admin", "team"):
        got = booking_groups(res[role])
        if [(g, n) for g, n, _ in got] != BOOKINGS_WANT:
            out.append("bookings (%s): groups must be %s, got %s" % (role, BOOKINGS_WANT, [(g, n) for g, n, _ in got]))
        if [a for _, _, a in got] != [True, True, False, False, False]:
            out.append("bookings (%s): only the two action groups are marked as needing action" % role)
        if len(re.findall(r'<thead>', res[role])) != 1:
            out.append("bookings (%s): one table with one header, the groups as row groups" % role)
    if '#/slot-requests' not in res["admin"] or '#/slot-requests' in res["team"]:
        out.append("bookings: the Slot requests link renders only for roles that can open that pane")
    got = [(g, n) for g, n, _ in booking_groups(res["scheduled"])]
    if got != [BOOKINGS_WANT[2], BOOKINGS_WANT[3]]:
        out.append("bookings: the Slot filter must still apply before grouping, got %s" % got)
    got = [(g, n) for g, n, _ in booking_groups(res["q"])]
    if got != [BOOKINGS_WANT[0]]:
        out.append("bookings: the search filter must still apply before grouping, got %s" % got)
    for f in ('name="q"', 'name="status"', 'name="sched"', 'name="brief"', 'name="from"', 'name="to"'):
        if f not in res["admin"]:
            out.append("bookings: the %s filter must stay" % f)
    return out


_r = subprocess.run(["node", "--input-type=module", "-e", BOOKINGS_HARNESS], cwd=ROOT, capture_output=True, text=True)
if _r.returncode:
    fail("bookings.js: could not run the grouping check: %s" % _r.stderr.strip()[-300:])
else:
    for msg in bookings_problems(_json.loads(_r.stdout)):
        fail(msg)


# --- Slot requests: a decline can be undone ----------------------------------------------------
# The real handler on the mock DB: declined → pending with its own audit row, nothing else
# reopens, team is refused; the view offers "Undo decline" on declined cards only, to roles the
# control list allows.
REOPEN_HARNESS = """
import view from "./public/js/views/slot-requests.js";
import { CONTROLS } from "./public/js/lib/panes.js";
import { call, fresh, IDS } from "./tests/helpers.ts";
const out = {};
let deps = fresh();
let r = await call(deps, "admin-slot-requests", "admin", { action: "reopen", request_id: IDS.request2 });
const req = deps.mem.tables.slot_requests.find((x) => x.id === IDS.request2);
const row = deps.mem.tables.audit_log.at(-1);
out.reopen = [r.status, req.status, row.action, row.target, deps.fakeMail.sent.length];
out.pending = (await call(fresh(), "admin-slot-requests", "owner", { action: "reopen", request_id: IDS.request1 })).status;
deps = fresh();
await call(deps, "admin-slot-requests", "admin", { action: "reopen", request_id: IDS.request2 });
out.approve_after = (await call(deps, "admin-slot-requests", "admin", { action: "approve", request_id: IDS.request2, choice: 1 })).status;
out.approved = (await call(deps, "admin-slot-requests", "admin", { action: "reopen", request_id: IDS.request2 })).status;
out.team = (await call(fresh(), "admin-slot-requests", "team", { action: "reopen", request_id: IDS.request2 })).status;
out.controls = CONTROLS["admin-slot-requests.reopen"] ?? null;
const card = (status) => ({ id: status, status, booking: { payer_name: "P" }, preferred_1: "2030-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" });
const rows = ["pending", "approved", "declined"].map(card);
out.html = Object.fromEntries(["owner", "admin", "team"].map((role) => [role, String(view.render({ show: "all", rows }, { role }))]));
console.log(JSON.stringify(out));
"""


def reopen_problems(res):
    out = []
    status, after, action, target, mails = res["reopen"]
    if status != 200 or after != "pending":
        out.append("admin-slot-requests: reopen must put a declined request back to pending, got %s / %s" % (status, after))
    if action != "slot_request.reopen" or target != "20000000-0000-4000-8000-000000000002":
        out.append("admin-slot-requests: reopen must write its own audit row, got %s" % action)
    if mails:
        out.append("admin-slot-requests: reopen must not email anyone")
    if res["pending"] != 409 or res["approved"] != 409:
        out.append("admin-slot-requests: only a declined request reopens (pending %s, approved %s)" % (res["pending"], res["approved"]))
    if res["approve_after"] != 200:
        out.append("admin-slot-requests: a reopened request must be approvable, got %s" % res["approve_after"])
    if res["team"] != 403:
        out.append("admin-slot-requests: team must be refused reopen on the server, got %s" % res["team"])
    if res["controls"] != ["owner", "admin"]:
        out.append("panes.js: admin-slot-requests.reopen must be owner and admin, got %s" % res["controls"])
    for role, page in res["html"].items():
        buttons = re.findall(r'<article class="card">.*?</article>', page, re.S)
        got = ['data-click="reopen"' in b for b in buttons]
        want = [False, False, role != "team"]
        if got != want:
            out.append("slot-requests (%s): Undo decline must render on declined cards only, got %s" % (role, got))
    return out


_fn = (ROOT / "supabase/functions/admin-slot-requests/handler.ts").read_text()
if not re.search(r'reopen:\s*\{\s*roles:\s*\["owner", "admin"\]', _fn):
    fail("admin-slot-requests: reopen must be registered for owner and admin")
_r = subprocess.run(["node", "--input-type=module", "-e", REOPEN_HARNESS], cwd=ROOT, capture_output=True, text=True)
if _r.returncode:
    fail("slot-requests: could not run the reopen check: %s" % _r.stderr.strip()[-300:])
else:
    for msg in reopen_problems(_json.loads(_r.stdout)):
        fail(msg)


# --- result --------------------------------------------------------------------------------------
if FAIL:
    print("check.py: %d problem(s)" % len(FAIL))
    for f in FAIL:
        print("  ✗ " + f)
    sys.exit(1)
print("check.py: all checks passed (%d functions, %d public files)" % (len(fn_dirs), len(files("public", {".js", ".css", ".html"}))))
