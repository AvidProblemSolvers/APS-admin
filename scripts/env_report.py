#!/usr/bin/env python3
"""Which Edge Function environment variables are set. Names only, never values.

The list comes from supabase/functions/_shared/config.ts (ENV_VARS). Nothing is deployed
and nothing remote is contacted; it looks only at what you hand it:

    python3 scripts/env_report.py                     this shell's environment
    python3 scripts/env_report.py --env-file FILE     a dotenv file (NAME=value lines)
    python3 scripts/env_report.py --names FILE        a list of names that are set, e.g. the
                                                      output of `supabase secrets list`, which
                                                      you run yourself and save or pipe (-)

Exit 1 if a required variable is missing. Variables the Supabase platform injects
(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) count as set when absent.
"""
import argparse
import os
import re
import sys
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "supabase/functions/_shared/config.ts"
ENTRY = re.compile(
    r'^\s*\{ name: "([A-Z][A-Z0-9_]*)", required: (true|false), provided: (true|false), breaks: "((?:[^"\\]|\\.)*)" \},$',
    re.M,
)


def manifest(src=None):
    """[(name, required, provided, breaks)] in file order."""
    src = CONFIG.read_text() if src is None else src
    body = re.search(r"export const ENV_VARS = \[\n(.*?)\n\] as const;", src, re.S)
    if not body:
        raise SystemExit("env_report: ENV_VARS not found in %s" % CONFIG)
    lines = [ln for ln in body.group(1).splitlines() if ln.strip() and not ln.strip().startswith("//")]
    out = []
    for ln in lines:
        m = ENTRY.match(ln)
        if not m:
            raise SystemExit("env_report: cannot parse ENV_VARS line: %s" % ln.strip()[:60])
        out.append((m.group(1), m.group(2) == "true", m.group(3) == "true", m.group(4).replace('\\"', '"')))
    return out


def set_from_env_file(text):
    names = set()
    for ln in text.splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", ln)
        if m and not ln.lstrip().startswith("#") and m.group(2).strip().strip("'\"").strip():
            names.add(m.group(1))
    return names


def set_from_names(text):
    return set(re.findall(r"\b[A-Z][A-Z0-9_]+\b", text))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--env-file", metavar="FILE")
    src.add_argument("--names", metavar="FILE", help="'-' reads stdin")
    a = ap.parse_args(argv)

    if a.env_file:
        present = set_from_env_file(Path(a.env_file).read_text())
        where = a.env_file
    elif a.names:
        present = set_from_names(sys.stdin.read() if a.names == "-" else Path(a.names).read_text())
        where = "stdin" if a.names == "-" else a.names
    else:
        present = {k for k, v in os.environ.items() if v.strip()}
        where = "environment"

    rows, missing = [], []
    for name, required, provided, breaks in manifest():
        if name in present:
            state = "set"
        elif provided:
            state = "provided"
        else:
            state = "MISSING" if required else "unset"
            if required:
                missing.append(name)
        rows.append((name, "required" if required else "optional", state, breaks))

    print("Edge Function variables (%s):" % where)
    w = max(len(r[0]) for r in rows)
    for kind in ("required", "optional"):
        print("\n  %s" % kind.upper())
        for name, k, state, breaks in rows:
            if k == kind:
                print(("    %-*s  %-8s  %s" % (w, name, state, "" if state in ("set", "provided") else breaks)).rstrip())
    if missing:
        print("\n%d required variable(s) missing: %s" % (len(missing), ", ".join(missing)))
        return 1
    print("\nAll required variables are set.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
