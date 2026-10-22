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

## Deploy
- [x] _headers, robots.txt, CSP (no _redirects needed: hash routing)
- [ ] GitHub Actions workflow
- [ ] DEPLOY.md

## BLOCKED
(none yet)
