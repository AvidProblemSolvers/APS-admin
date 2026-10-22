# APS — Build Specification

Reference document. Read the sections the current session names. `CLAUDE.md` holds the
tokens, type rules, verbatim copy and hard rules that govern all of it.

**Contents**
- §1 Scaffold and build pipeline
- §2 The Traverse (3D)
- §3 Stations, probe, motion
- §4 AEO layer and the answer library
- §5 Supabase schema
- §6 Payment, scheduler, Google Meet
- §7 Project brief
- §8 Admin application
- §9 Deploy and CI

---

# §1 — Scaffold and build pipeline

## Repo layout
```
aps-site/
├── CLAUDE.md
├── SPEC.md
├── PROGRESS.md
├── DECISIONS.md
├── gen.py                    build: content → dist/
├── check.py                  validator
├── serve.py                  local preview
├── package.json              esbuild only
├── src/
│   ├── templates/
│   │   ├── base.html  home.html  answer.html  answers_index.html
│   │   ├── confirmed.html  booked.html  brief.html
│   │   └── privacy.html  terms.html
│   ├── css/main.css
│   ├── js/
│   │   ├── traverse.js       Three.js scene → bundled
│   │   ├── probe.js  booking.js  analytics.js
│   ├── content/
│   │   ├── site.json         every editable string
│   │   └── answers/*.md      YAML front matter + body
├── assets/APS_LOGO.png
├── assets/generated/         processed logo, favicons
├── dist/                     generated, gitignored
└── .github/workflows/build.yml
```

## gen.py
Reads `src/content/site.json` and `src/content/answers/*.md`, renders Jinja2 templates
into `dist/`, copies CSS, JS and assets. In §5 it gains a Supabase source with
`site.json` as the fallback — structure it now so that swap is one function.

Generates: `index.html`, `answers/index.html`, `answers/<slug>.html`, `confirmed.html`,
`booked.html`, `privacy.html`, `terms.html`, plus everything in §4.

## Logo processing
`assets/APS_LOGO.png` has a solid dark teal background. With Pillow: make the background
transparent using a soft alpha ramp on antialiased edges so there is no fringe, trim
transparent margins, write transparent PNGs at 1x and 2x, a favicon (32, 64, 180) and an
apple-touch-icon into `assets/generated/`. Keep the original untouched.

The white wordmark, the turquoise flame and the pill outline must all survive intact.
Verify by inspecting the output at 360px — a teal halo around the letters means the
tolerance is too tight.

## main.css
All tokens from CLAUDE.md as custom properties on `:root`. A reset. The type scale.
Google Fonts with `preconnect` and `display=swap`, Latin subset only. Visible focus rings
using the accent gradient. Mobile-first, 320px→2560px.

## package.json
esbuild as the only dependency.
`"build:3d": "esbuild src/js/traverse.js --bundle --minify --format=iife --outfile=dist/static/js/traverse.js"`

## check.py
Validates: every generated page is well-formed HTML; exactly one `<h1>` per page; every
internal link resolves; every JSON-LD block parses and carries `@type`; every answer page
summary is 40–60 words; `llms.txt` lists every published page. Exit non-zero on failure.

## serve.py
`http.server` over `dist/` on port 8000, with correct MIME for `.md` as `text/markdown`.

---

# §2 — The Traverse

The signature of the site. The visitor does not scroll down a page — **the camera moves
forward through a corridor in 3D space.** Five stations sit at increasing depth. Scroll
(wheel and touch) maps to camera z-position.

**Not scroll-jacking.** The user's scroll input is respected exactly; only its effect
changes. No momentum fighting, no snapping, no hijacked gestures.

## Three particle states, one `uProgress` uniform

| uProgress | State | Description |
|---|---|---|
| 0.00 | **NOISE** | ~11,000 particles scattered through a wide tube, drifting chaotically, dim, in `--muted` and dark teal. Unreadable. |
| 0.50 | **FLOW** | They resolve into concentric streamline rings rotating slowly around the corridor axis, brighter, shifting into the accent gradient. Structure, no meaning. |
| 1.00 | **MARK** | They converge into the silhouette of the APS flame at the far end of the corridor, holding while the offer station is on screen. |

Noise → signal → recognition. The firm's thesis, rendered literally.

## Target positions for the mark
Rasterise the flame glyph from the transparent logo to an offscreen canvas at init, read
the alpha channel, sample opaque pixels into an array of target x/y positions, weighting
toward glyph edges so the silhouette reads crisply. Do this **once** and cache it — never
per frame.

## Technical
- three.js, one `THREE.Points`, custom GLSL, single draw call
- Attributes: `aNoise`, `aFlow`, `aMark`, `aSeed`
- Vertex shader mixes noise→flow over `uProgress` 0–0.55 and flow→mark over 0.70–1.00,
  with per-particle timing jitter from `aSeed` so the mark assembles organically rather
  than snapping
- `FogExp2` in `--void` so depth reads
- 16 faint ring meshes down the corridor for structure and parallax
- Camera drifts slightly with mouse position, lerped — parallax, never enough to disorient
- Cap pixel ratio at 2; pause the render loop when the tab is hidden
- Short boot sequence: logo and a loading bar, then the scene fades in

## Stations
HTML sections positioned `fixed`, fading in and out as `uProgress` passes through their
band, with a blur-to-sharp transition. **Real DOM text, never canvas-drawn.**

## HUD
Logo top-left. A depth rail on the right with a travelling dot, labelled NOISE at top and
SIGNAL at bottom. A readout bottom-left: depth in metres and a coherence value 0.00–1.00.

## Flat mode — mandatory
If viewport width < 900px, **or** `prefers-reduced-motion` is set, **or** WebGL2 is
unavailable: skip the scene entirely and render the same stations as a conventional
scrolling page with normal section backgrounds. Nobody gets motion sickness on a phone,
and the content is identical either way.

## Gate
Does the mark read as the flame at the far end? 60fps on a mid-range phone? If the mark is
mushy, increase sample points concentrated on glyph edges.

---

# §3 — Stations, probe, motion

Verbatim copy lives in CLAUDE.md and must not be reworded.

## Station 1 — Hero
- Eyebrow (mono, accent gradient): `OPERATIONS CONSULTING FOR AN AI-FIRST WORLD`
- H1 (Fraunces 900, `--white`): the verbatim headline
- Subhead: "Avid Problem Solvers combines Lean Six Sigma, Agile, and AI to resolve the
  operational problems slowing your business down — the visible ones and the hidden ones."
- No button here.

## Station 2 — What we do
Mono eyebrow `WHAT WE DO`. The verbatim definition sentence, Fraunces 700, max 34ch per
line. Then two cards side by side:

- **KNOWN** — "Already on a dashboard. Somebody named it months ago and it hasn't moved."
- **UNKNOWN** — "Nobody has measured it yet. It shows up as a number that feels wrong."

Then the problem probe (below).

## Station 3 — How we work
Mono eyebrow. Headline: "Methodology is a means, not a mission."
Body: "We don't apply Lean Six Sigma, Agile, or AI as a fixed toolkit. We start with your
problem and use whichever method it actually calls for — sometimes all three, sometimes one."

Three descriptors in a row, mono labels, one line each, separated by hairline rules. No
numbered markers, no icons, no cards:
- **LEAN SIX SIGMA** — "Root-cause discipline. Waste removed for good, not managed around."
- **AGILE** — "Iteration and fast feedback where certainty is low."
- **AI** — "Pattern detection across data you already have, surfacing what manual review misses."

## Station 4 — Who you'll be talking to
Mono eyebrow. Lead: "Twenty years of operations work, across regulated, operational, and
go-to-market problems."

Three sector anchors, each with a mono label **and** one line of body so the row is
balanced:
- **BFSI & INSURANCE** — "Regulated environments where the cost of getting it wrong is
  measured in fines, not friction."
- **QUICK COMMERCE & LOGISTICS** — "High-velocity operations where a small inefficiency
  compounds thousands of times a day."
- **GTM STRATEGY** — "Commercial engines where the bottleneck is rarely where it looks."

Centred payoff in Fraunces: "The sectors change. The shape of the problems doesn't."
Then, below a hairline rule, the verbatim confidentiality statement.

No photo, no name, no logos, no testimonials. The restraint is the point.

## Station 5 — The offer
Mono eyebrow `ONE OFFER. NO TIERS.`

A 2px vertical accent-gradient line that self-draws beside the price — a callback to the
flame. **"$1,199"** in Fraunces 900 with tabular numerals. Beneath: "one hour, flat."

Body: "One hour with someone who has solved this before. Bring your hardest problem, leave
with a path to the first three things to do on Monday."

Three-step strip with hairline connectors:
`SECURE YOUR HOUR → CHOOSE YOUR TIME → SEND THE BRIEF`

The single filled-gradient button: **"Book your hour"** → `#book` for now.
Under it: "Payment secured by Razorpay · You'll choose your slot immediately after"

Well below, above a hairline rule:
`NO RETAINER · NO PROPOSAL PROCESS · NO DISCOVERY CALL FIRST`

## The problem probe
In station 2. Mono label `WHICH KIND IS YOURS?` over three fields, and a submit button
labelled **"Read it"** — OUTLINED, not filled. There is only ever one filled button.

| # | Label | Control | | Placeholder |
|---|---|---|---|---|
| 1 | "The business" | single line | optional | "What does it do? e.g. quick-commerce delivery, 40 staff" |
| 2 | "The problem" | textarea, the largest | **required** | "What's going wrong?" |
| 3 | "What 'fixed' looks like" | single line, the button beside it | optional | "The outcome you want" |

Only the problem gates the button: disabled under 10 characters. The optional fields never
block submission — someone who fills only the problem gets the same experience as before.

**Fires ONLY on explicit submit** — button click, Enter in a single-line field, or Enter
in the problem (Shift+Enter is a new line). Never on keystroke, debounce or blur. Nothing
is transmitted until the person deliberately sends it.

Beneath the fields, visible **before** submission:
*"Your description is stored so we can prepare. Nothing else is collected."*

Verdict by local regex, no API call, over the problem **and** the goal (never the business
line — "40 staff" is not a measurement). Measurable terms (numbers, %, days, cost, rate,
cycle, churn, throughput, backlog, SLA) versus uncertainty terms (can't tell, not sure,
no idea, feels, seems, why, unclear, nobody knows). The goal is weighted, because that is
where measurability usually shows up:
- a goal with a number or a named quantity (time, errors, complaints, orders, margin,
  conversion, half, double…) counts as measurable → KNOWN, or KNOWN SYMPTOM if there is
  uncertainty;
- a goal that names no target ("make it better", "improve", "smoother") with nothing
  measurable in the problem → NOT YET MEASURABLE;
- an empty goal changes nothing: the problem alone decides, exactly as before.

Four verdicts:

| Verdict | Condition | Response |
|---|---|---|
| **KNOWN** | measurable, no uncertainty | "You've already named a measurable quantity. That's a root-cause problem — the first hour goes into isolating where in the process the variance enters." |
| **UNKNOWN** | uncertainty, nothing measurable | "There's no measured quantity in that sentence, which is the tell. Before anything gets fixed, the problem has to be made measurable." |
| **KNOWN SYMPTOM, UNKNOWN CAUSE** | both | "You can measure the effect but not explain it — the most expensive shape. The dashboard is right and the diagnosis is missing." |
| **NOT YET MEASURABLE** | neither | "Stated that way it can't be tested. The first move is turning it into something with a number attached." |

Result shows a mono verdict chip, then the body, then a quiet link "Bring it to an hour →".
Storage is wired in §5 — leave a single no-op function here.

## Motion system
Per CLAUDE.md's curve and exclusions:
- Every Fraunces headline uses the same line-by-line mask reveal, staggered 90ms.
  Repeating it makes it the page's signature gesture rather than a hero trick.
- The KNOWN and UNKNOWN cards enter from opposite directions and meet in the middle.
- Mono labels animate letter-spacing 0.34em → 0.18em as they fade in — type tightening
  into focus.
- Every hairline rule draws rather than appears.
- The three-step strip reveals in strict sequence because it describes one.
- The price gains weight 700 → 900 as it fades. **Never count up from zero.**
- The CTA is magnetic within ~80px, pointer devices only.

---

# §4 — AEO layer and the answer library

This decides whether Claude, ChatGPT and Perplexity ever cite APS. Eight mechanisms.

## Why two layers exist
Answer engines cite pages that answer **one question completely**. They do not cite
landing pages. The Traverse converts people who already know the name; the answer library
is what machines quote. Neither works alone.

## 1. robots.txt — welcome AI crawlers by name
```
User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-User
User-agent: Claude-SearchBot
User-agent: anthropic-ai
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: Amazonbot
User-agent: Meta-ExternalAgent
User-agent: CCBot
User-agent: Bingbot
User-agent: Googlebot
Allow: /
Disallow: /confirmed
Disallow: /booked
Disallow: /brief/

User-agent: *
Allow: /
Disallow: /confirmed
Disallow: /booked
Disallow: /brief/

Sitemap: https://avidproblemsolvers.com/sitemap.xml
```
CCBot matters more than it looks — Common Crawl feeds a great many models.

## 2. llms.txt and llms-full.txt
`/llms.txt` — a markdown index written for models, not browsers:
```markdown
# Avid Problem Solvers

> Operations consulting firm using Lean Six Sigma, Agile and AI to diagnose and resolve
> backend and frontend operational inefficiencies. One-hour consultations, $1,199 flat.

## Core
- [What APS does](https://avidproblemsolvers.com/): definition, method, offer

## Answers
- [How to find an operational bottleneck you cannot measure](/answers/unmeasured-bottleneck): ...
```
One line per page, with a one-clause description.

`/llms-full.txt` — every published page's full text in one file, headings intact. Some
crawlers take this in a single fetch instead of walking the site.

## 3. Markdown mirrors
Every HTML page also written as `.md` at the same path. `/answers/dmaic-ai.html` and
`/answers/dmaic-ai.md`. Several AI fetchers parse markdown more reliably than HTML.

## 4. JSON-LD per page type
| Page | Schema |
|---|---|
| `/` | `Organization` + `ProfessionalService` + `Offer` + `FAQPage` + `WebSite` |
| `/answers/*` | `Article` + `FAQPage` + `BreadcrumbList` |
| `/glossary/*` | `DefinedTerm` inside a `DefinedTermSet` |

The `Organization` block carries `sameAs` pointing at LinkedIn and directory listings.
That is **entity grounding** — how a model becomes confident that "APS", "Avid Problem
Solvers" and avidproblemsolvers.com are one entity.

The homepage `FAQPage` block, structured data only, never rendered visibly:
- "What does Avid Problem Solvers do?" → the verbatim definition
- "What methodologies does APS use?" → "APS applies Lean Six Sigma for root-cause analysis
  and waste elimination, Agile for iterative delivery under uncertainty, and AI for pattern
  detection across existing business data. Methods are selected based on the problem, not
  applied as a fixed toolkit."
- "How much does an APS consultation cost?" → "APS offers a single flat-rate consultation
  at $1,199 for one hour, with no retainer, no proposal process and no preliminary
  discovery call."
- "How do I book a consultation with APS?" → "Payment is made first through Razorpay,
  after which you immediately choose your preferred time slot. Sessions run 60 minutes
  over Google Meet, with availability three days per week."
- "What sectors does APS have experience in?" → "APS brings twenty years of operations
  experience across BFSI and insurance, quick commerce and logistics, and go-to-market
  strategy, and works with companies in any industry."
- "Does APS publish client names?" → "No. APS does not name clients on its website as a
  matter of client confidentiality."

## 5. Answer-shaped content
Every answer page opens with a **40–60 word self-contained summary** that reads correctly
when lifted out with no preceding sentence. That paragraph is what gets quoted.

❌ *"As we discussed above, this is why it matters."*
✅ *"An unmeasured bottleneck is a constraint that does not appear in any existing report,
usually because the process step it sits in was never instrumented. The standard way to
find one is to compare theoretical cycle time against observed cycle time and attribute
the gap."*

## 6. The answer library — 24 topics

**Operations diagnosis**
1. How to find an operational bottleneck you cannot measure
2. Known vs unknown operational problems: how to tell them apart
3. Why process improvement projects stall after the first win
4. How to tell if a problem is a process problem or a people problem
5. What to measure first when nothing is instrumented
6. How to scope an operations diagnostic in one hour

**Lean Six Sigma in an AI era**
7. Does Lean Six Sigma still work when AI handles the data analysis
8. DMAIC when the Measure phase is automated: what changes
9. Root cause analysis with AI: what it finds that humans miss
10. When Lean Six Sigma is the wrong tool
11. Lean Six Sigma vs Agile: choosing by problem type, not preference
12. How to run a value stream map on a process nobody has documented

**Sector**
13. Operational bottlenecks in BFSI: where they usually sit
14. AML/KYC operations: reducing false positives without raising risk
15. Quick commerce operations: why small inefficiencies compound
16. Last-mile logistics: the metrics that actually predict failure
17. Insurance claims operations: cycle time vs accuracy
18. GTM bottlenecks: why the constraint is rarely where it looks

**Buying consulting**
19. What a one-hour operations consultation can realistically deliver
20. How to prepare for a consulting session so it is not wasted
21. Flat-fee vs retainer consulting: which fits which problem
22. What to ask a consultant before you hire one
23. Why consulting firms do not publish client names
24. How to brief a consultant on a problem you cannot articulate

Each page: 600–900 words, the extractable summary at top, an H2 per sub-question, internal
links to 2–3 sibling answers, one quiet CTA at the end.

**Write six at launch, then two a week.** Six strong pages beat 24 thin ones.

Front matter format:
```yaml
---
title: How to find an operational bottleneck you cannot measure
slug: unmeasured-bottleneck
question: How do I find a bottleneck that doesn't show up in any report?
summary: 40–60 words, self-contained, quotable with no preceding context.
related: [known-vs-unknown, what-to-measure-first]
published: true
---
```

## 7. Entity consistency
The identical name, description and URL everywhere: the site, LinkedIn, Clutch,
Crunchbase, Google Business Profile. Models cross-reference; inconsistency reads as noise
and suppresses confidence.

## 8. Technical hygiene
Static HTML on Cloudflare means sub-100ms TTFB globally. Canonical URL on every page. One
H1. Clean heading hierarchy. **No content injected by JavaScript.** `sitemap.xml`
including the `.md` mirrors.

---

# §5 — Supabase schema

The site stays fully static. Supabase is reached only by Edge Functions and by `gen.py`
at build time.

## Tables
```
site_content      key text pk, value text not null, updated_at timestamptz default now()

answers           id uuid pk, slug text unique not null, title text not null,
                  summary text not null, body_md text not null, question text,
                  related text[], published boolean default false,
                  created_at, updated_at

bookings          id uuid pk, razorpay_payment_id text unique not null,
                  razorpay_order_id text, amount numeric not null,
                  currency text default 'USD', status text not null,
                  payer_name text, payer_email text, heard_from text, session_id text,
                  slot_start timestamptz, slot_end timestamptz,
                  meet_link text, calendar_event_id text,
                  brief_token text unique, brief_submitted_at timestamptz,
                  scheduled boolean default false, reminder_sent_at timestamptz,
                  brief_nudge_sent_at timestamptz, created_at

availability_rules id uuid pk, weekday int check (weekday between 0 and 6),
                  start_time time, end_time time,
                  timezone text default 'Asia/Kolkata', active boolean default true

slot_overrides    id uuid pk, date date, kind text check (kind in ('block','extra')),
                  start_time time, end_time time, note text

slot_requests     id uuid pk, booking_id uuid references bookings,
                  preferred_1 timestamptz, preferred_2 timestamptz, preferred_3 timestamptz,
                  requester_timezone text,
                  status text default 'pending' check (status in ('pending','approved','declined')),
                  note text, created_at

project_briefs    id uuid pk, booking_id uuid references bookings unique,
                  problem text, already_tried text, how_measured text,
                  what_fixed_looks_like text, who_involved text,
                  file_urls text[], submitted_at timestamptz, updated_at

probe_queries     id uuid pk, problem_text text not null, verdict text,
                  business_text text, goal_text text,   -- optional, ≤600 like problem_text
                  session_id text, country text, referrer text,
                  converted boolean default false, created_at
                  -- no email, no name, no IP

page_views        id uuid pk, country text, region text, city text, referrer text,
                  utm_source text, utm_medium text, utm_campaign text,
                  path text, device text, session_id text, created_at
                  -- explicitly NO ip column

webhook_events    id uuid pk, event_id text unique not null, source text,
                  event_type text, payload jsonb, processed_at

team_members      id uuid pk references auth.users, email text unique not null,
                  full_name text, role text check (role in ('owner','admin','team')),
                  active boolean default true, invited_by uuid, created_at

audit_log         id uuid pk, actor_id uuid, actor_email text not null,
                  action text not null, target text, old_value text, new_value text,
                  actor_country text, created_at
```

## Row Level Security — enable on every table
- `bookings`, `slot_requests`, `project_briefs`, `probe_queries`, `page_views`,
  `webhook_events`, `team_members`, `audit_log`: **no policies** for anon or
  authenticated. Edge Functions only, with the service-role key.
- `site_content`, `answers`: SELECT for anon (gen.py reads them at build). No client writes.
- `audit_log`: insert-only from Edge Functions. **No UPDATE or DELETE path exists for
  anyone, including the owner.** Append-only by design.

Helper function `current_user_role()` returning the caller's role from `team_members`.
Seed `team_members` with one owner row for `OWNER_EMAIL`.

Indexes: `bookings.created_at`, `bookings.scheduled`, `bookings.payer_email`,
`bookings.slot_start`, `probe_queries.created_at`, `probe_queries.verdict`,
`page_views.created_at`, `page_views.country`, `audit_log.created_at`.

## Edge Function — save-probe
Accepts `{ business_text, problem_text, goal_text, verdict, session_id }`. Only
`problem_text` is required (≥10 characters); the other two are optional and stored as null
when empty. Rejects any field over 600 characters. Rate limits 5 per session per hour. Resolves country from the request IP server-side and **discards
the IP**. Normalises the referrer. Inserts one row. Returns 204.

## Edge Function — track-view
Same IP discipline. Normalise referrers to labels: `linkedin.com` → "LinkedIn",
`google.*` → "Google", `chatgpt.com` and `chat.openai.com` → "ChatGPT", `perplexity.ai` →
"Perplexity", `claude.ai` → "Claude", empty → "Direct". Rate limit per IP per minute.
Returns 204. CORS restricted to avidproblemsolvers.com.

## Frontend wiring
Generate a `session_id` once per session with `crypto.randomUUID()` in `sessionStorage`.
Pass it to the probe, to track-view, and to Razorpay as a note. Fire track-view once per
session, fire-and-forget, wrapped in try/catch that fails silently. **Analytics must never
break or slow the page.**

## gen.py update
Read `site_content` and published `answers` from Supabase at build time using the anon
key. If the fetch fails, fall back to `src/content/` and print a loud warning — the build
must never produce a page with empty copy.

## Verification
Confirm anon cannot read `bookings`, `probe_queries`, `page_views`, `team_members` or
`audit_log`. Test explicitly and record the result in PROGRESS.md.

---

# §6 — Payment, scheduler, Google Meet

**Order is deliberate: PAY FIRST, then CHOOSE A SLOT.** Payment first means revenue is
never lost; the only failure mode is someone who paid but hasn't scheduled, which a
reminder job handles.

## 1. Payment
Razorpay Quick Pay Button, Live mode, fixed USD 1,199. Button ID from env.

- Load the script only when the offer station approaches — never on initial page load
- It renders inside a modal opened by the styled "Book your hour" button; our button keeps
  its own styling
- Modal: `--void` at high opacity with backdrop blur, closes on Escape and backdrop click,
  traps focus, returns focus on close
- **One optional field** above the pay button: "How did you hear about us?" — free text,
  marked optional, passed to Razorpay as a note. Never required.
- Pass `session_id` as a note too
- If the script fails to load, fall back to a mailto link

## 2. Edge Function — razorpay-webhook
The source of truth for payments.

1. Verify `X-Razorpay-Signature` as HMAC SHA256 of the **RAW request body** against
   `RAZORPAY_WEBHOOK_SECRET`. Use the raw body, not a re-serialised object, or the
   signature will never match. On failure return 401 and write nothing.
2. Idempotency: insert `event_id` into `webhook_events`; on unique violation return 200 —
   that's a retry.
3. On `payment.captured`: insert a `bookings` row (**divide amount by 100** — Razorpay
   sends the smallest currency unit), generate a random `brief_token`, `scheduled = false`.
4. Mark any `probe_queries` rows with that `session_id` as `converted = true`.
5. Email `OWNER_EMAIL` via Resend with payer details, `heard_from`, and any linked probe
   text. If email fails, still return 200.
6. Return 200 for unhandled event types.

## 3. The scheduler — ours, no third party

**Edge Function get-slots:** reads `availability_rules` and `slot_overrides`, generates
the next 30 days of slots, subtracts already-booked slots, returns them as UTC ISO
timestamps. 24-hour minimum notice, 15-minute buffer after each.

**Store everything in UTC.** Convert for display only, using the visitor's
`Intl.DateTimeFormat().resolvedOptions().timeZone`. Show each slot in **both** their
timezone and IST so there is no ambiguity.

**Edge Function claim-slot:** takes `booking_id` and `slot_start`. Inside a transaction,
`SELECT ... FOR UPDATE`, verify the slot is still free, then insert. Add a unique
constraint on `slot_start` for non-cancelled bookings. **Without the lock and the
constraint, two people booking simultaneously both get the slot.**

## 4. /confirmed
Razorpay's redirect target. Logo top-left, mono eyebrow `PAYMENT CONFIRMED`, Fraunces
"Now choose your hour.", then the slot picker: a month grid with available days marked,
times listed for the selected day, in the same visual language as the rest of the site.

Beneath the picker, a quiet link: **"None of these work for me"** → a form for three
preferred times in their timezone, writing a `slot_requests` row with status pending and
emailing the owner. Response copy: *"We'll confirm within one business day."*

`noindex`. If someone lands without a payment reference, still show the page and picker but
change the eyebrow to `COMPLETE YOUR BOOKING` — people return here from their receipt
email and must not be locked out.

## 5. Google Calendar + Meet — Edge Function create-meeting
OAuth with a **stored refresh token**, not a service account (that needs Workspace
domain-wide delegation).

Call `events.insert` with **`conferenceDataVersion=1`** and a `conferenceData.createRequest`
carrying a unique `requestId`. **Without that query parameter the API silently ignores
conferenceData and creates the event with no Meet link — no error.** Read the link from
`conferenceData.entryPoints`, save to `bookings.meet_link` and the event id to
`calendar_event_id`. Invite both parties.

**Test whether a personal Gmail account returns a Meet link.** Workspace accounts always
do; personal accounts are not guaranteed. Record the result in PROGRESS.md before
proceeding.

## 6. /booked
Logo centred, Fraunces "You're booked.", the confirmed time in both timezones, the Meet
link, and a prominent link to the project brief.

## 7. Emails via Resend
On confirmation: one to the client with the time, Meet link, calendar invite and brief
link; one to the owner with everything including their probe text.

## 8. pg_cron, every 6 hours
Find `bookings` where `scheduled = false`, `status = 'captured'`, `created_at` older than
24 hours, `reminder_sent_at` null → email the `/confirmed` link via Resend → set
`reminder_sent_at`. Write an `audit_log` row with `actor_email = 'system'`.

---

# §7 — Project brief

The intake that makes a one-hour session worth $1,199.

**Route `/brief/<token>`**, where token is `bookings.brief_token`. No login — the token is
the authentication. `noindex`, excluded from sitemap and llms.txt.

Invalid token or cancelled booking → a clean "This link has expired" page. Never an error
dump.

## The form
Same design language, generous spacing, one question per block:

1. **What's the problem?** (long text, required) — prefilled from their probe submission
   if a `probe_queries` row shares the `session_id`, labelled *"You wrote this earlier,
   edit freely"*. The probe's business line, if given, leads it as "The business: …".
2. **What have you already tried?** (long text)
3. **How is it measured today, if at all?** (long text)
4. **What does "fixed" look like?** (long text, required) — prefilled from the probe's
   goal the same way, with the same label
5. **Who else is involved?** (short text)
6. **Anything to look at?** — file upload to Supabase Storage, private bucket, max 5 files,
   25MB each, `pdf/csv/xlsx/png/jpg/docx` only

Save draft on blur to `project_briefs` so a half-finished brief is never lost. A clear
"Submit brief" button sets `submitted_at` and emails the owner.

Confirmation screen: *"Got it. I'll have read this before we speak."* Nothing else.

## Automatic nudge
Extend the pg_cron job: if a session is 48 hours away and `brief_submitted_at` is null,
email the brief link **once**, setting `brief_nudge_sent_at`. Never twice.

## Why this exists
69% of buyers report inconsistency between what a firm's website says and what its people
say, and that gap reads as risk. The site promises preparation; the brief is where that
promise is kept before the call starts.

---

# §8 — Admin application

A **separate repo and Cloudflare Pages project**, deployed to
`admin.avidproblemsolvers.com`. Plain HTML/CSS/JS SPA, no framework.

Connects to the **existing** Supabase project. Tables already exist — do **not** create
tables, run migrations or alter the schema.

Carry over every design token and font rule from CLAUDE.md, plus `--warn #F0C27B` and
`--bad #E8977A` for state pills only.

## Design intent
This is a **tool, not a showcase.** No 3D, no Fraunces display type, no scroll reveals, no
texture, no decorative motion. Dense, functional, fast. Small type, tight spacing, hairline
rules, tabular numerals. Well-made instrumentation. The only motion is 150ms colour
transitions on hover and focus.

## Auth
Supabase Auth, **magic-link only**. No passwords, no social, no sign-up form — sign-up must
be impossible from the interface. Only emails in `team_members` with `active = true` may
sign in; anyone else gets a clean "Not authorised" screen with no hint whether the address
exists. `noindex` everywhere, robots.txt disallowing all.

## Roles — enforced in TWO places
The UI, **and** independently inside every Edge Function.

| Role | Access |
|---|---|
| **owner** | Everything |
| **admin** | Content, answers, bookings without revenue, signals, traffic |
| **team** | Read-only: bookings, signals, traffic |

Tabs a role cannot access are **not rendered at all**, not rendered-and-hidden.

## Panes

**1. Bookings** (default, all roles) — dense table, newest first: date paid, name, email,
amount, slot in IST and their timezone, status, heard from, brief submitted yes/no.
Expandable row showing the full project brief and any linked probe text.

Stat cards: total, upcoming, **PAID BUT NOT SCHEDULED** (accent highlight), **BRIEF
MISSING**, revenue this month.

**Revenue is owner-only** — the Edge Function must not return revenue to admin or team at
all. Omit it server-side, don't hide it client-side.

Rows unscheduled for over 24 hours are flagged and pinned to the top with a one-click
"Email booking link". Filters; CSV export for owner.

**2. Slot requests** (owner, admin) — pending alternate-time requests with the three
preferred times in both timezones. Approve → calls create-meeting, sends both emails, sets
the booking. Decline → emails them the standard slot list. Both write audit rows.

**3. Availability** (owner, admin) — edit `availability_rules` as a weekly grid. Add
`slot_overrides` to block a date or open an extra one. Shows the next 30 days as a visitor
would see them, so a mistake is visible before it costs a booking.

**4. Content** (owner, admin) — edit every `site_content` key, grouped by station, with
live character counts. Every changed field writes one `audit_log` row with old and new
values. A prominent **PUBLISH** button triggers the GitHub Actions workflow via
`repository_dispatch` and shows build status. Nothing reaches the live site until Publish
is pressed.

**5. Answers** (owner, admin) — list, create and edit answer pages: title, slug, summary,
body markdown, related slugs, published toggle. Live word count and a **warning if the
summary falls outside 40–60 words**, because that paragraph is what answer engines quote.
Publishing an answer also triggers a rebuild.

**6. Signals** (all roles) — `probe_queries` as a readable list, not a table: the problem
text in full at readable size, then a quiet meta row with date, verdict chip, country,
referrer, and a "Converted" chip if that session later paid. Filter by verdict, converted,
date, country. Search across problem text. Sort by **"converted only"** — the most valuable
view here, because it shows which problems turn into paid hours.

No personal data in this table. Do not add columns for it.

**7. Traffic** (all roles) — views by country, by referrer using normalised labels, UTM
campaigns, daily chart, 7/30/90 day selector. Watch the Claude, ChatGPT and Perplexity
referrer counts — that is the AEO layer working.

**8. Team** (owner only) — invite by magic link, change role, deactivate (never delete;
audit history must survive). The last active owner cannot be demoted or deactivated. An
owner cannot change their own role. Every action writes an audit row.

**9. Audit** (owner only) — reverse-chronological, with before/after diffs. Filters, CSV
export. **Append-only:** no delete control, no edit control, no Edge Function path that can
remove an entry — not even for the owner.

Fast and fully usable on mobile.

---

# §9 — Deploy and CI

## GitHub Actions — aps-site
`.github/workflows/build.yml`

Triggers: push to `main`, **and** `repository_dispatch` with event type `publish` (fired by
the admin's Publish button).

Steps: checkout → Python with `requirements.txt` (Jinja2, Pillow, PyYAML, Markdown — no
supabase-py: gen.py reads PostgREST with urllib) → `npm ci` → `npm run build:3d` →
`python gen.py` → `python check.py` → **fail the build if check.py fails** → deploy `dist/`
to Cloudflare Pages via wrangler.

Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`.

## GitHub Actions — aps-admin
The same, minus `gen.py` — it is a plain SPA build.

## Edge Function — trigger-publish
Called by the admin. Verifies the caller is owner or admin, fires `repository_dispatch` at
the GitHub API with a stored PAT, returns the run id. The admin polls run status so the
Publish button can show progress.

## Cloudflare Pages config
`_headers` and `_redirects`:
- Cache static assets aggressively, HTML briefly
- Serve `.md` mirrors as `text/markdown; charset=utf-8`
- Force HTTPS; pick apex or www and canonical it consistently
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`, and a CSP permitting
  Razorpay's script and Supabase's origin

## Manual steps to document
Write `DEPLOY.md` listing exactly what to configure in the Cloudflare dashboard: both
Pages projects, both custom domains, and the DNS records.

---

# Launch checklist

**AEO**
- [ ] `/llms.txt` returns the index; `/llms-full.txt` contains every published page
- [ ] Every page has a `.md` mirror that resolves
- [ ] robots.txt names all 16 crawlers and is reachable
- [ ] Every JSON-LD block validates in Google's Rich Results Test
- [ ] Each answer summary is 40–60 words and reads correctly quoted alone
- [ ] sitemap.xml submitted to Google Search Console and Bing Webmaster Tools
- [ ] JavaScript disabled → full content still renders
- [ ] Ask Claude and ChatGPT a question an answer page covers. Note the answer. Re-test in
      30 days. **That is the only real AEO metric.**

**Security**
- [ ] In the Supabase API docs, GET `bookings` with the anon key → empty or permission
      error, never data. Repeat for `probe_queries`, `page_views`, `project_briefs`,
      `team_members`, `audit_log`.

**Payment and booking**
- [ ] Test payment → `/confirmed` → slot picker loads
- [ ] Bad webhook signature → 401, nothing written
- [ ] Same event twice → one booking row
- [ ] Two browsers claiming the same slot → one succeeds, one gets a clean message
- [ ] Book from a non-IST timezone → times correct in both
- [ ] Google Meet link appears in both calendar invites
- [ ] Alternate-time request → appears in admin → approve → emails and invite go out
- [ ] Brief link works, saves drafts, file upload works, nudge fires at 48 hours

**Roles** — each with a separate real email
- [ ] team: no content, answers, team or audit tabs; no revenue; no save controls in DOM
- [ ] admin: content editable; no team or audit; no revenue figure
- [ ] Call a content-write function directly as team → refused server-side
- [ ] Deactivated member cannot sign in; last owner cannot be demoted

**Site**
- [ ] Mark reads as the flame at the end of the Traverse; 60fps on a mid-range Android
- [ ] Below 900px and with reduced-motion → flat layout, no WebGL
- [ ] Lighthouse mobile: 90+ performance, 100 accessibility
- [ ] Publish button in admin → build runs → change is live
