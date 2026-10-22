# DEPLOY — putting APS Admin live

Everything below is done by you. Nothing in this repo has touched Supabase, GitHub or
Cloudflare. Order matters: Supabase first, then GitHub, then Cloudflare.

---

## 0. Confirm three things with the site repo first

These are the integration points this repo assumes but could not see:

1. **`site_settings` shape.** Assumed: `key text primary key, value text, updated_at timestamptz,
   updated_by uuid`, with a trigger that writes one `audit_log` row per change and resolves the
   actor from `updated_by` → `team_members`. If `value` is **jsonb** rather than text, tell me —
   values are currently written as plain strings.
2. **`site_settings` key names.** The site must read these exact keys:

   | key | values |
   |---|---|
   | `razorpay_mode` | `test` or `live` |
   | `razorpay_button_id_test` | `pl_` + 14 letters/digits, or empty |
   | `razorpay_button_id_live` | `pl_` + 14 letters/digits, or empty |
   | `scheduler_timezone` | IANA name, default `Asia/Kolkata` |
   | `scheduler_slot_minutes` | default `60` |
   | `scheduler_buffer_minutes` | default `15` |
   | `scheduler_min_notice_hours` | default `24` |
   | `scheduler_window_days` | default `30` |

   The site picks `razorpay_button_id_<razorpay_mode>`. If gen.py reads these at build time, a
   change goes live on the next build — the Settings pane has **Save & Publish** for that. If
   `get-slots` reads the scheduler keys at request time, those take effect immediately.
3. **`create-meeting` contract.** The admin's Approve calls the site's `create-meeting` with
   `POST { "booking_id": "<uuid>" }` and the service-role key, **after** setting
   `slot_start`/`slot_end`/`scheduled` on the booking, and expects `{ "meet_link": "…" }` back.
   The admin then sends the two confirmation emails itself. If `create-meeting` also emails,
   one side must stop — tell me which.

Also check that the partial unique index on `bookings(slot_start)` for non-cancelled rows exists
(§6.3). Approve relies on it to refuse a double booking.

---

## 1. Supabase (project `rtqitjlpwkubdiakhiqu`)

### Auth
- **Authentication → Sign In / Providers → Email:** enabled. Turn **off** "Allow new users to sign
  up". The admin never signs anyone up (`create_user: false`); invites go through the admin API,
  which still works with sign-ups off.
- **Authentication → URL Configuration:** add `https://admin.avidproblemsolvers.com/` to
  **Redirect URLs**. Magic links and invites return there.
- **Authentication → SMTP:** set custom SMTP (Resend: `smtp.resend.com`, port 465, user `resend`,
  password = a Resend API key) with a sender on your verified domain. The built-in sender is
  rate-limited and only delivers to project members.
- **Email templates:** optionally reword "Magic Link" and "Invite user" so they say APS Admin.
- **Owner account:** the owner's row in `team_members` must have `id` = their `auth.users.id`. If
  the owner has no auth user yet: Authentication → Users → **Invite user** with the owner's email,
  then set that user's id on the owner row in `team_members` (or insert the row with that id).

### Edge Function secrets
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. Set the rest
(Dashboard → Edge Functions → Secrets, or the CLI):

```
ADMIN_ORIGIN=https://admin.avidproblemsolvers.com
SITE_ORIGIN=https://avidproblemsolvers.com
OWNER_EMAIL=<owner's address>
MAIL_FROM=APS <hello@avidproblemsolvers.com>
RESEND_API_KEY=<Resend key>
GITHUB_PAT=<fine-grained PAT, see below>
GITHUB_SITE_REPO=AvidProblemSolvers/<site repo name>
BRIEF_BUCKET=<the private Storage bucket the brief uploads go to>
```

**GitHub PAT:** fine-grained, resource owner `AvidProblemSolvers`, **only the site repo**.
Permissions: *Contents: Read and write* (required for `repository_dispatch`), *Actions: Read*
(to show build status), *Metadata: Read*. Set an expiry and a reminder.

### Deploy the functions
From this repo, with your own logged-in Supabase CLI:

```
supabase functions deploy admin-me admin-bookings admin-slot-requests admin-availability \
  admin-content admin-answers admin-signals admin-traffic admin-team admin-audit \
  admin-settings trigger-publish --project-ref rtqitjlpwkubdiakhiqu
```

Keep **Enforce JWT verification** on (the default) for all twelve. Each function also verifies
the user and their role itself. If the site repo also ships a `trigger-publish`, deploy only one
of them.

### Strongly recommended: make append-only true at the database too
The admin has no update or delete path to `audit_log`, but the service-role key bypasses RLS. A
migration in the **site repo** closes that:

```sql
create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_log_no_update_delete before update or delete on audit_log
  for each row execute function audit_log_append_only();
revoke update, delete, truncate on audit_log from anon, authenticated, service_role;
```

### Verify
- Launch checklist → **Security**: anon GET on `bookings`, `probe_queries`, `page_views`,
  `project_briefs`, `team_members`, `audit_log` returns nothing.
- Launch checklist → **Roles**: sign in with three real addresses (owner, admin, team).

---

## 2. GitHub

1. Create **`AvidProblemSolvers/APS-admin`** (private). Push this folder:
   `git remote add origin git@github.com:AvidProblemSolvers/APS-admin.git && git push -u origin main`
2. **Settings → Secrets and variables → Actions → Secrets:**
   - `SUPABASE_ANON_KEY` — the project's anon/publishable key (public by design)
   - `CLOUDFLARE_API_TOKEN` — token with *Account → Cloudflare Pages → Edit*
   - `CLOUDFLARE_ACCOUNT_ID`
   - (optional variable `SUPABASE_URL`; defaults to the project URL)
3. **Site repo:** its `build.yml` must listen for `repository_dispatch` with `types: [publish]`
   (§9). That is what the admin's PUBLISH button fires.
4. Branch protection on `main` requiring the `build` check is worth turning on: it runs the role,
   revenue and audit tests on every PR.

---

## 3. Cloudflare

1. **Workers & Pages → Create → Pages → Direct Upload**, project name **`aps-admin`**, production
   branch `main`. (The workflow deploys with `wrangler pages deploy`; the project must exist first.)
   Upload anything once, or just let the first workflow run deploy.
2. **aps-admin → Custom domains → Set up a domain:** `admin.avidproblemsolvers.com`. With the zone
   on Cloudflare this creates the DNS record for you:
   `CNAME  admin  aps-admin.pages.dev  (proxied)`.
3. **SSL/TLS → Edge Certificates:** *Always Use HTTPS* on.
4. The `_headers` file in the build sets the CSP (scripts from self only, connections to the
   Supabase origin only), `X-Robots-Tag: noindex`, HSTS, `frame-ancestors 'none'` and friends —
   nothing to configure.
5. Optional extra layer: **Zero Trust → Access** application on `admin.avidproblemsolvers.com`
   with an email allow-list. Not required — the admin is already gated by magic link + active
   `team_members` row + per-function role checks — but it hides even the sign-in page.

---

## 4. First run

1. Push → the `build` workflow tests, checks, builds and deploys.
2. Open `https://admin.avidproblemsolvers.com`, enter the owner address, click the emailed link.
3. **Team → Send invite** for the admin and team addresses.
4. **Settings:** paste both Razorpay Payment Button ids, leave mode on **Test**, Save & Publish,
   make a test payment on the site. Switch to **Live** when ready (it asks to confirm).
5. Work through the launch checklist's Roles and Payment sections with three real addresses.
