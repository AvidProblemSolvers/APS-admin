// Deterministic seed data for tests and the local mock. Amounts are deliberately odd
// (e.g. 98765.43) so a leak of revenue to a non-owner is easy to detect in a response body.

import type { Row } from "../supabase/functions/_shared/types.ts";

export const NOW = new Date("2026-10-20T06:30:00Z"); // 12:00 IST, a Tuesday

export const IDS = {
  owner: "00000000-0000-4000-8000-000000000001",
  owner2: "00000000-0000-4000-8000-000000000002",
  admin: "00000000-0000-4000-8000-000000000003",
  team: "00000000-0000-4000-8000-000000000004",
  inactive: "00000000-0000-4000-8000-000000000005",
  stranger: "00000000-0000-4000-8000-000000000099",
  newcomer: "00000000-0000-4000-8000-000000000098",
  outsider: "00000000-0000-4000-8000-000000000097",
  bookingPaidUnscheduled: "10000000-0000-4000-8000-000000000001",
  bookingUpcoming: "10000000-0000-4000-8000-000000000002",
  bookingPast: "10000000-0000-4000-8000-000000000003",
  bookingFresh: "10000000-0000-4000-8000-000000000004",
  bookingLastMonth: "10000000-0000-4000-8000-000000000005",
  request1: "20000000-0000-4000-8000-000000000001",
};

export const LEAK_AMOUNTS = [98765.43, 87654.32, 76543.21, 65432.1, 54321.09];

let base = NOW;
const h = (hours: number) => new Date(base.getTime() + hours * 3_600_000).toISOString();

export function seed(now: Date = NOW): Record<string, Row[]> {
  base = now;
  return {
    team_members: [
      { id: IDS.owner, email: "owner@avidproblemsolvers.com", full_name: "Owner One", role: "owner", active: true, created_at: h(-2000) },
      { id: IDS.admin, email: "admin@avidproblemsolvers.com", full_name: "Admin Person", role: "admin", active: true, invited_by: IDS.owner, created_at: h(-1500) },
      { id: IDS.team, email: "team@avidproblemsolvers.com", full_name: "Team Member", role: "team", active: true, invited_by: IDS.owner, created_at: h(-1000) },
      { id: IDS.inactive, email: "gone@avidproblemsolvers.com", full_name: "Former Member", role: "admin", active: false, invited_by: IDS.owner, created_at: h(-900) },
    ],
    bookings: [
      {
        id: IDS.bookingPaidUnscheduled, razorpay_payment_id: "pay_MOCK0001", amount: LEAK_AMOUNTS[0], currency: "USD",
        status: "captured", payer_name: "Priya Raman", payer_email: "priya@example.com", heard_from: "Claude",
        session_id: "sess-a", scheduled: false, brief_token: "tok-a", created_at: h(-50),
      },
      {
        id: IDS.bookingUpcoming, razorpay_payment_id: "pay_MOCK0002", amount: LEAK_AMOUNTS[1], currency: "USD",
        status: "captured", payer_name: "Daniel Okafor", payer_email: "daniel@example.com", heard_from: "LinkedIn",
        session_id: "sess-b", scheduled: true, slot_start: h(72), slot_end: h(73), meet_link: "https://meet.google.com/abc-defg-hij",
        brief_token: "tok-b", brief_submitted_at: h(-5), created_at: h(-30),
      },
      {
        id: IDS.bookingPast, razorpay_payment_id: "pay_MOCK0003", amount: LEAK_AMOUNTS[2], currency: "USD",
        status: "captured", payer_name: "Mei Tanaka", payer_email: "mei@example.com", heard_from: "",
        session_id: "sess-c", scheduled: true, slot_start: h(-100), slot_end: h(-99), brief_token: "tok-c", created_at: h(-200),
      },
      {
        id: IDS.bookingFresh, razorpay_payment_id: "pay_MOCK0004", amount: LEAK_AMOUNTS[3], currency: "USD",
        status: "captured", payer_name: "Sam Ortiz", payer_email: "sam@example.com", heard_from: "Google",
        session_id: "sess-d", scheduled: false, brief_token: "tok-d", created_at: h(-2),
      },
      {
        id: IDS.bookingLastMonth, razorpay_payment_id: "pay_MOCK0005", amount: LEAK_AMOUNTS[4], currency: "USD",
        status: "captured", payer_name: "Ana Lima", payer_email: "ana@example.com", heard_from: "ChatGPT",
        session_id: "sess-e", scheduled: true, slot_start: h(-600), slot_end: h(-599), brief_token: "tok-e",
        brief_submitted_at: h(-700), created_at: h(-720),
      },
    ],
    project_briefs: [
      {
        booking_id: IDS.bookingUpcoming, problem: "Our month-end close takes eleven days and nobody can say why.",
        already_tried: "Hired a controller. Bought a close tool.", how_measured: "Days from period end to sign-off.",
        what_fixed_looks_like: "Five days, predictably.", who_involved: "CFO, two AP clerks",
        file_urls: ["tok-b/close-calendar.xlsx"], submitted_at: h(-5), updated_at: h(-5),
      },
    ],
    probe_queries: [
      { problem_text: "Month-end close takes eleven days and nobody can say why.", verdict: "fit", session_id: "sess-b", country: "GB", referrer: "LinkedIn", converted: true, created_at: h(-31) },
      { problem_text: "Support tickets bounce between three teams before anyone owns them.", business_text: "B2B SaaS, 40 people", goal_text: "One owner within an hour.", verdict: "fit", session_id: "sess-a", country: "IN", referrer: "Claude", converted: true, created_at: h(-51) },
      { problem_text: "Our warehouse picks are accurate but slow on Mondays only.", verdict: "fit", session_id: "sess-x", country: "US", referrer: "Google", converted: false, created_at: h(-80) },
      { problem_text: "I want a logo designed for my bakery please.", verdict: "not_fit", session_id: "sess-y", country: "AU", referrer: "Direct", converted: false, created_at: h(-120) },
      { problem_text: "Quotes take a week to go out and we lose deals to faster competitors.", verdict: "unclear", session_id: "sess-z", country: "IN", referrer: "Perplexity", converted: false, created_at: h(-150) },
    ],
    page_views: pageViews(),
    slot_requests: [
      {
        id: IDS.request1, booking_id: IDS.bookingPaidUnscheduled, status: "pending", requester_timezone: "America/New_York",
        preferred_1: h(96), preferred_2: h(120), preferred_3: h(144), note: "Mornings Eastern please.", created_at: h(-20),
      },
    ],
    availability_rules: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday, start_time: "10:00", end_time: "18:00", timezone: "Asia/Kolkata", active: true,
    })),
    slot_overrides: [],
    site_content: [
      { key: "hero.eyebrow", value: "OPERATIONS CONSULTING", updated_at: h(-300) },
      { key: "hero.h1", value: "We fix the problems you can name. And the ones you can't — yet.", updated_at: h(-300) },
      { key: "what.definition", value: "Avid Problem Solvers is an operations consulting firm.", updated_at: h(-300) },
      { key: "how.method", value: "Methodology is a means, not a mission.", updated_at: h(-300) },
      { key: "offer.price", value: "$1,199", updated_at: h(-300) },
      { key: "offer.cta", value: "Book your hour", updated_at: h(-300) },
      { key: "answers_index.title", value: "Answers", updated_at: h(-200) },
      { key: "answers_index.empty_state.title", value: "Nothing here yet", updated_at: h(-200) },
      { key: "answers_index.empty_state.body", value: "Answers appear here as they are published.", updated_at: h(-200) },
      { key: "answers_index.categories.buying", value: "Buying", updated_at: h(-200) },
      { key: "answers_index.categories.running", value: "Running", updated_at: h(-200) },
      { key: "answers_index.categories.buying.lead", value: "What to know before you hire help.", updated_at: h(-200) },
      { key: "answers_index.categories.buying.lead.note", value: "Shown under the lead on wide screens.", updated_at: h(-200) },
      { key: "answers_index.categories.buying.lead.cta.label", value: "Read the guide", updated_at: h(-200) },
    ],
    answers: [
      {
        slug: "what-is-operations-consulting", title: "What is operations consulting?",
        summary: "Operations consulting diagnoses and fixes the way work moves through a business.",
        body_md: "## What it is\n\nBody text.", question: "What is operations consulting?", related: [], published: true,
        created_at: h(-400), updated_at: h(-400),
      },
    ],
    site_settings: [
      { key: "razorpay_mode", value: "test", updated_at: h(-100), updated_by: IDS.owner },
      { key: "razorpay_payment_url_test", value: "https://rzp.io/rzp/TESTPAGE1", updated_at: h(-100), updated_by: IDS.owner },
    ],
    audit_log: [
      { actor_id: IDS.owner, actor_email: "owner@avidproblemsolvers.com", action: "content.update", target: "hero.eyebrow", old_value: "CONSULTING", new_value: "OPERATIONS CONSULTING", actor_country: "IN", created_at: h(-300) },
      { actor_id: null, actor_email: "system", action: "booking.reminder", target: IDS.bookingPaidUnscheduled, actor_country: null, created_at: h(-26) },
    ],
  };
}

function pageViews(): Row[] {
  const refs = ["Direct", "Google", "LinkedIn", "Claude", "ChatGPT", "Perplexity"];
  const countries = ["IN", "US", "GB", "AE", "SG", "DE"];
  const rows: Row[] = [];
  let x = 7;
  for (let d = 0; d < 95; d++) {
    const n = 3 + (d * 7) % 11;
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) % 2147483648;
      rows.push({
        country: countries[x % countries.length],
        referrer: refs[(x >> 3) % refs.length],
        utm_source: i % 4 === 0 ? "newsletter" : null,
        utm_medium: i % 4 === 0 ? "email" : null,
        utm_campaign: i % 4 === 0 ? (d < 30 ? "oct-ops" : "sep-ops") : null,
        path: i % 3 === 0 ? "/answers/what-is-operations-consulting" : "/",
        device: i % 2 ? "mobile" : "desktop",
        session_id: `pv-${d}-${i % 5}`,
        created_at: new Date(base.getTime() - d * 86_400_000 - i * 600_000).toISOString(),
      });
    }
  }
  return rows;
}
