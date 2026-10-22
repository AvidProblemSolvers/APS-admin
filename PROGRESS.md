# PROGRESS — APS Admin (SPEC §8)

## Foundation
- [x] CLAUDE.md rewritten for the admin repo
- [ ] Repo scaffold, build.py, check.py, package.json
- [ ] Edge Function shared layer: auth, roles per action, PostgREST data layer, audit writer
- [ ] In-memory mock DB + mock auth/mail/GitHub, offline test harness
- [ ] SPA shell: magic-link auth, Not authorised screen, role-filtered tabs

## Panes
- [ ] 1. Bookings (all roles) — stats, flagged rows, expand, filters, CSV (owner), revenue owner-only server-side
- [ ] 2. Slot requests (owner, admin)
- [ ] 3. Availability (owner, admin) — weekly grid, overrides, 30-day preview
- [ ] 4. Content (owner, admin) — grouped keys, char counts, audit per field, PUBLISH
- [ ] 5. Answers (owner, admin) — 40–60 word summary warning, rebuild on publish
- [ ] 6. Signals (all roles)
- [ ] 7. Traffic (all roles)
- [ ] 8. Team (owner)
- [ ] 9. Audit (owner) — append-only, diffs, filters, CSV
- [ ] 10. Settings (owner, admin) — site_settings, validation per key, updated_by, no own audit row

## Deploy
- [ ] _headers, _redirects, robots.txt, CSP
- [ ] GitHub Actions workflow
- [ ] DEPLOY.md

## BLOCKED
(none yet)
