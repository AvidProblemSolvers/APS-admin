# PROGRESS — APS Admin (SPEC §8)

## Foundation
- [x] CLAUDE.md rewritten for the admin repo
- [x] Repo scaffold, build.py, check.py, package.json
- [x] Edge Function shared layer: auth, roles per action, PostgREST data layer, audit writer
- [x] In-memory mock DB + mock auth/mail/GitHub, offline test harness
- [x] SPA shell: magic-link auth, Not authorised screen, role-filtered tabs

## Edge Functions (server half of every pane) — done, 233 offline tests
- [x] 12 functions: admin-me, admin-bookings, admin-slot-requests, admin-availability, admin-content,
      admin-answers, admin-signals, admin-traffic, admin-team, admin-audit, admin-settings, trigger-publish
- [x] Role matrix test: every function × action × role, plus inactive / stranger / anonymous
- [x] Revenue sweep: every action admin/team can call, response bodies + the PostgREST query itself
- [x] Audit append-only: data layer refuses UPDATE/DELETE before any request; source scan; audit fn has list + export only
- [x] Mutation-checked: widening export_csv to admin, or selecting amount for all, fails the suite

## Panes (UI)
- [x] 1. Bookings (all roles) — stats, flagged rows, expand, filters, CSV (owner), revenue owner-only server-side
- [x] 2. Slot requests (owner, admin)
- [x] 3. Availability (owner, admin) — weekly grid, overrides, 30-day preview
- [x] 4. Content (owner, admin) — grouped keys, char counts, audit per field, PUBLISH
- [x] 5. Answers (owner, admin) — 40–60 word summary warning, rebuild on publish
- [x] 6. Signals (all roles)
- [x] 7. Traffic (all roles)
- [x] 8. Team (owner)
- [x] 9. Audit (owner) — append-only, diffs, filters, CSV
- [x] 10. Settings (owner, admin) — site_settings, validation per key, updated_by, no own audit row

## Verification (offline)
- [x] 274 tests (`npm test`): role matrix, revenue sweep, append-only audit, every pane's behaviour, UI renders per role
- [x] `python3 check.py` passes: HTML, noindex, CSP without unsafe-inline, tokens-only colours, no Fraunces, no IP headers, no remote imports
- [x] Real browser (headless Chrome against the mock): owner sees 10 tabs; team DOM has exactly 3 tab links;
      team typing #/audit lands on Bookings; deactivated member gets "Not authorised"; 500px layout stacks cleanly
- [x] `deno check` passes on every function entry point
- [x] `npm run smoke`: 16-step real-browser click-through (all panes, every write flow, then the team view) — passes

## Email domain lock
- [x] `_shared/email_domain.js`: the one place the domain is written; `ALLOWED_EMAIL_DOMAIN` env, default `@avidproblemsolvers.com`
- [x] `_shared/http.ts` refuses off-domain users before the team_members lookup, same `403 not_authorised` as unknown
- [x] Team invite refuses off-domain addresses
- [x] Sign-in page refuses off-domain addresses without calling GoTrue (courtesy only); placeholder from the same constant
- [x] check.py: no hard-coded domain outside the shared module; gate must precede the team_members lookup; browser copy byte-identical
- [x] Tests (369 total): off-domain active owner refused by every function × action without reading any table;
      on-domain non-member refused; on-domain members unchanged; lookalike domains; env override; smoke steps for the page and a bypassed page

## Settings keys renamed to match the site repo
- [x] `razorpay_button_id_{test,live}` → `razorpay_payment_url_{test,live}` in the schema (both copies), view, mock seed, tests, smoke, DEPLOY.md, DECISIONS.md
- [x] Validation: https only; host `rzp.io` exactly or a subdomain of `razorpay.com`; no port, userinfo, query or fragment; unreserved path characters; 500-char cap
- [x] Fields labelled as the Razorpay payment page URL; `razorpay_mode` unchanged
- [x] Tests: look-alikes (`rzp.io.evil.com`, `evil-rzp.io`, `www.rzp.io`, `razorpay.com.evil.com`, `evilrazorpay.com`), userinfo/port/http, injection characters, 500/501 boundary, old keys refused; check.py, npm test, npm run smoke all pass

## Sign-in by six-digit code (mail scanners spend magic links)
- [x] After "Email me a sign-in code" succeeds, a code field appears on the same screen (numeric input mode, `autocomplete="one-time-code"`, six digits) for every on-domain address, known or not
- [x] `verifyCode()` → `POST /auth/v1/verify` `{ type: "email", email, token }`; session saved exactly as the fragment flow saves it
- [x] Neutral sent message, `create_user: false`, domain check before any request (send and verify) all kept; wrong/expired/unknown-address codes get one plain message
- [x] URL-fragment sign-in still works (existing sessions, links that survive)
- [x] Mock GoTrue issues single-use codes and serves `/auth/v1/verify`; codes listed at `/__mock/links`
- [x] check.py: `/verify` with `type "email"`; code field attributes. Tests: 408 pass. Smoke: 17 steps pass (code sign-in incl. a wrong code first; unknown address gets the field and the same bad-code message)
- [x] DEPLOY.md: Magic Link template must show `{{ .Token }}` and contain no link; OTP length 6

## Light theme (presentation only)
- [x] Every CSS colour is a role-named token (`--bg`, `--surface`, `--text`, `--text-muted`, `--accent`, `--accent-fg`, `--on-accent`, `--danger`, `--ok`, …) on `:root`; dark values are the shipped colours, and the var-resolved rules diff identical to the previous admin.css
- [x] `:root[data-theme="light"]` redefines every token; text, muted, accent text, warn/danger and text-on-accent all ≥ 4.5:1 in both themes
- [x] Header toggle (Dark / Light, `aria-pressed`) next to Sign out; also on the sign-in and Not authorised screens; choice in localStorage `aps-admin-theme`, every access in try/catch
- [x] `/js/theme-init.js`: classic blocking script in `<head>` applies the stored theme before `<body>` exists (external, not inline — the CSP forbids inline scripts)
- [x] check.py guards: no raw colour outside the token blocks (hex, colour functions, named colours); token parity both ways; dark tokens stay on the CLAUDE.md palette; pre-paint script in `<head>`; toggle rendered with aria-pressed and text labels. Each mutation-tested (17 mutations, all fail check.py)
- [x] Smoke: 19 steps pass (theme stored, applied before `<body>` on reload, toggled from the header; storage that throws still renders dark and toggles)

## Deploy
- [x] _headers, robots.txt, CSP (no _redirects needed: hash routing)
- [x] GitHub Actions workflow (deno check → npm test → check.py → build → wrangler pages deploy)
- [x] DEPLOY.md

## NEEDS CONFIRMATION from the site repo (not blocked — built to a documented assumption)
- `site_settings` column types (assumed `value text`, `updated_by uuid`) and the key names in DEPLOY.md §0
- `create-meeting` request shape (`{ booking_id }`) and whether it already sends the confirmation emails
- Partial unique index on `bookings.slot_start` exists

## BLOCKED
(none — deploying, secrets, DNS and the Supabase dashboard are the user's by design; see DEPLOY.md)

## Pane timing and Content sections (2026-10-30)
- [x] `scripts/measure_panes.mjs`: real-browser timing of every tab (first visit, revisit): click → data paint, calls per click, serial/parallel. Mock gained `--latency-ms` / `--cold-ms` to model server time (default 0)
- [x] Content pane: every dot is one nesting level, to any depth — first segment = section tab, middle segments = headings (indented, own rule, ancestor crumbs), last = field. Own fields first, then groups A–Z. Labels derived from segments
- [x] Content search above the tab row: key or text, across every section, each hit shows its section › heading path
- [x] Section in the hash (`#/content/<section>`); router hands the sub-path to the open pane instead of remounting it, so unsaved edits survive a tab switch
- [x] check.py guards (random segment names each run): one tab per first segment; every key in exactly one tab at its dot depth; labels derived; own fields first; search across sections with heading path; search box above tabs; hash round-trip; publish notice. 18 mutations, all fail check.py
- [x] Smoke: 20 steps pass (nesting depth and indentation, search keeps focus, edit survives tab switch, tab survives reload)
- [x] Measured before fixing: one Edge Function call per tab, nothing serial; client cost 20–70 ms; the wait is the server round trip and cold start (DECISIONS.md)
- [x] Pane data cached in memory for the session (`lib/cache.js`): revisit within 30 s → no request; older → paints from memory, refreshes in the background (repaints only if changed and untouched); any write, sign-in and sign-out clear it; loads that began before a write are discarded. Revisit data paint 265 ms → 10–40 ms (modelled), 0 calls
- [x] Rejected by the numbers: skeleton (first paint already ~10 ms), parallel fetches (one call per tab)
- [x] Smoke: 22 steps pass (revisit makes no request; a write makes Audit fetch again — fails if invalidation is removed)

## Content: group textareas, website order, tab weight (2026-10-30)
- [x] Each heading's own single-line fields are ONE textarea, "Label: value" per line, parsed back into the individual keys on save; heading, field count, latest Updated, full keys in small type under it; grows to fit, no inner scrollbar
- [x] Unknown, duplicated or missing label, or a line with no label: error named inline above the group, that group's save held (others still save); nothing dropped or invented
- [x] Values with line breaks (and colon or shared labels) render as their own field below the group with the reason
- [x] Order by sort_order (nulls last, key tiebreak; a group at the lowest sort_order beneath it); null or absent column = key order; server never names the column
- [x] Both nav rows at weight 600 (Plex Mono 600 loaded), active still by colour + underline
- [x] check.py guards for all of the above, driving the real input/save handlers; 23 mutations, all fail check.py
- [x] Smoke: 23 steps pass, incl. two lines edited in one group → exactly those two keys change server-side, a mistyped label shows its error and holds the save
