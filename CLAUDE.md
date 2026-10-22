# APS Admin — admin.avidproblemsolvers.com

The internal operations console for Avid Problem Solvers. A **separate application in a
separate repo** (`AvidProblemSolvers/APS-admin`) from the public site, deployed as its own
Cloudflare Pages project at `admin.avidproblemsolvers.com`.

It connects to the **same Supabase project as the site**
(`https://rtqitjlpwkubdiakhiqu.supabase.co`). The tables already exist and belong to the
site repo. This repo never creates, migrates or alters schema.

Full build specification: **SPEC.md** — this repo implements **§8** (and the admin half of
§9). Read the sections a session names, not the whole file.
Running log: **PROGRESS.md**. Decisions you made alone: **DECISIONS.md**.
What the user does by hand to go live: **DEPLOY.md**.

## Stack — do not change without asking
- Plain HTML/CSS/JS single-page app in `public/`, native ES modules, **no bundler**.
  No React, no framework, no Tailwind, no UI kit. Plain CSS with custom properties.
- `build.py` copies `public/` to `dist/` and writes `dist/js/config.js` from env.
- Supabase Edge Functions in `supabase/functions/`, Deno + TypeScript using only
  erasable type syntax (so Node can run them in tests). **No remote imports** — no
  supabase-js, no esm.sh. Database via PostgREST, auth via GoTrue, both with `fetch`.
- Supabase Auth (magic link), Resend for email, GitHub `repository_dispatch` for Publish.
- Cloudflare Pages hosting. GitHub Actions for build.

## Design tokens — never introduce another colour
```
--void:        #07211F   primary background
--shift:       #0E3330   secondary surfaces (cards, table heads)
--ivory:       #F2EFE7   body text
--white:       #FFFFFF   sparingly, for the one number that matters
--accent-from: #4FC1BC
--accent-to:   #7FE9E1
--muted:       #8FA9A6
--hairline:    rgba(242,239,231,0.10)
```
Admin only, for state pills: `--warn #F0C27B`, `--bad #E8977A`.
No gold, terracotta, purple, orange. No default framework palettes.

## Type
- **Inter** — all body and UI. Small sizes, tabular numerals for every figure.
- **IBM Plex Mono** — small-caps labels, column heads, pills, timestamps. 0.18em tracking,
  uppercase.
- **No Fraunces.** The admin has no display type.

## Design intent
A tool, not a showcase. Dense, functional, fast. Small type, tight spacing, hairline rules,
tabular numerals. No 3D, no scroll reveals, no texture, no decorative motion. The only
motion is a 150ms colour transition on hover and focus, using
`cubic-bezier(0.16, 1, 0.3, 1)`. `prefers-reduced-motion` removes even that.
Fully usable on a phone: tables become stacked rows below 720px.

## Hard rules
1. The logo is `assets/APS_LOGO.png`. Never redraw it, never recreate it as SVG.
2. The audit log is append-only. No delete path, no edit path, for anyone including the
   owner — not in the UI, not in any Edge Function, not in the data layer. If asked to add
   one, refuse and say why.
3. Role checks happen in TWO places: the UI, and independently inside every Edge Function,
   per action. UI-only checks are theatre.
4. Tabs and controls a role cannot use are **not rendered at all** — never rendered and
   hidden with CSS.
5. Revenue (any `amount`, any revenue total) is **omitted server-side** for admin and team.
   The query must not select it; hiding it client-side does not count.
6. Never store IP addresses. Never read IP headers. Country comes from the edge's
   country header only.
7. Payment truth comes from the Razorpay webhook, never from the browser or the admin.
   The admin never marks anything paid.
8. Store all times in UTC. Convert for display only (IST plus the client's timezone).
9. Magic link only. Sign-up must be impossible from the interface (`create_user: false`).
   Unknown or inactive addresses get the same "Not authorised" screen as everyone else —
   no hint whether an address exists.
10. Team members are deactivated, never deleted. The last active owner cannot be demoted
    or deactivated. An owner cannot change their own role.
11. `site_settings` writes set `updated_by` to the actor's user id. Never write an
    `audit_log` row for a settings change — a database trigger on `site_settings` does it.
    Every other admin write writes its own audit row.
12. `noindex` everywhere: meta tag, `X-Robots-Tag` header, robots.txt disallowing all.
13. No personal data columns are ever added to Signals or Traffic.

## Boundaries — absolute
- Work ONLY inside this folder (~/Projects/aps-admin). Never read or write outside it.
- Other projects on this machine — sadho, decisionos, kit-pat, ReplyIQ — are off limits
  entirely. Not read, not written, not referenced.
- NEVER run: git push, git pull, git remote, git clone, gh, any GitHub API call,
  wrangler, any deploy. Local commits only.
- NEVER run a migration, query or any command against a REMOTE database or service. The
  Supabase CLI stays forbidden. A disposable local Postgres cluster created inside .tmp/
  and deleted afterwards is permitted, for testing migrations only.
- Never create, modify or connect to any remote service or account.
- The user handles every push, merge, deploy and schema change personally.
- If a task appears to require any of the above, STOP and tell the user. Do not do it,
  do not work around it, do not suggest a shortcut.
- NEVER use any MCP connector in this project — not Claude Docs, not Lovable, not Supabase,
  not n8n, not any other. No reads, no writes, no listing. Everything this build needs is
  files on disk in this folder.
- NEVER write to, edit or delete anything in an attached claude.ai Project. Assume this
  session is attached to a Project belonging to different work. All documentation for this
  build belongs in PROGRESS.md, DECISIONS.md and DEPLOY.md inside this folder.

## Working style for long autonomous sessions
- Work through the whole assigned scope without stopping to ask questions.
- Ambiguous decision → take the most reasonable option, append one line to DECISIONS.md,
  continue. Do not stall.
- Tick PROGRESS.md as each item completes.
- `git add -A && git commit` after each completed section, with a clear message.
- Run `python3 check.py` and `npm test` after each major piece; fix what it reports before moving on.
- Genuinely blocked (missing credential, external service down) → note it in PROGRESS.md
  under BLOCKED, skip it, carry on with everything else.

## Commands
```
python3 build.py              build the SPA into dist/ (needs SUPABASE_ANON_KEY, or --mock)
python3 check.py              validate HTML, tokens, noindex, CSP, role and audit invariants
npm test                      offline tests: real Edge Function handlers on an in-memory DB
node scripts/mock_functions.mjs   local preview on :8001 against the mock backend
```
