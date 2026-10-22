# DECISIONS — judgement calls made without asking

- Tests and the local mock run the **real** Edge Function handlers in Node 24 (native TS type stripping) against an in-memory DB, instead of a separate Python re-implementation in `scripts/mock_functions.py`, so the mock can never drift from production logic. The site repo's mock was not read (outside this folder). Mock lives at `scripts/mock_functions.mjs`.
- No supabase-js anywhere: functions talk to PostgREST and GoTrue with `fetch`, the SPA talks to GoTrue with `fetch`. Zero dependencies, nothing to bundle, nothing remote to import.
