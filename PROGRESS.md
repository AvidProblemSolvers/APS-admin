# PROGRESS — APS Admin (SPEC §8)

## Foundation
- [x] CLAUDE.md rewritten for the admin repo
- [ ] Repo scaffold, build.py, check.py, package.json
- [x] Edge Function shared layer: auth, roles per action, PostgREST data layer, audit writer
- [x] In-memory mock DB + mock auth/mail/GitHub, offline test harness
- [ ] SPA shell: magic-link auth, Not authorised screen, role-filtered tabs

## Edge Functions (server half of every pane) — done, 233 offline tests
- [x] 12 functions: admin-me, admin-bookings, admin-slot-requests, admin-availability, admin-content,
      admin-answers, admin-signals, admin-traffic, admin-team, admin-audit, admin-settings, trigger-publish
- [x] Role matrix test: every function × action × role, plus inactive / stranger / anonymous
- [x] Revenue sweep: every action admin/team can call, response bodies + the PostgREST query itself
- [x] Audit append-only: data layer refuses UPDATE/DELETE before any request; source scan; audit fn has list + export only
- [x] Mutation-checked: widening export_csv to admin, or selecting amount for all, fails the suite

## Panes (UI)
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
