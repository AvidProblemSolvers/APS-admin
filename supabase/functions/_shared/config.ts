// Every environment variable the admin's Edge Functions read, and the only way to read one.
// Code never calls env("...") directly: it goes through requiredEnv / optionalEnv / envOr,
// which log "config: NAME is not set" (once per isolate per name) so a missing secret shows
// up in the function logs instead of only when someone clicks the button it breaks.
//
// required — an action fails without it (requiredEnv throws a 500 "misconfigured").
// optional — has a safe fallback or degrades; the request carries on.
// provided — injected by the Supabase platform; never set by hand.
//
// scripts/env_report.py parses this list (one entry per line, keep the shape) and check.py
// holds the names that are live in production: never rename one here.

import { HttpError } from "./errors.ts";

export const ENV_VARS = [
  { name: "SUPABASE_URL", required: true, provided: true, breaks: "Every function: no database, no sign-in." },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, provided: true, breaks: "Every function: no database, no sign-in." },
  { name: "RESEND_API_KEY", required: true, provided: false, breaks: "Bookings > Email booking link fails; slot request approve/decline emails are skipped with a warning." },
  { name: "MAIL_FROM", required: true, provided: false, breaks: "Bookings > Email booking link fails; slot request approve/decline emails are skipped with a warning." },
  { name: "GITHUB_PAT", required: true, provided: false, breaks: "Publish fails, and its status cannot be read." },
  { name: "GITHUB_SITE_REPO", required: true, provided: false, breaks: "Publish fails, and its status cannot be read." },
  { name: "ADMIN_ORIGIN", required: false, provided: false, breaks: "CORS allows only https://admin.avidproblemsolvers.com; invite and email links point there." },
  { name: "SITE_ORIGIN", required: false, provided: false, breaks: "Booking and brief links in client emails point at https://avidproblemsolvers.com." },
  { name: "OWNER_EMAIL", required: false, provided: false, breaks: "Approval notices go to the approver instead of the owner; client emails carry no reply-to." },
  { name: "BRIEF_BUCKET", required: false, provided: false, breaks: "Brief file links are signed against the bucket \"briefs\"; a different bucket gives dead links." },
  { name: "ALLOWED_EMAIL_DOMAIN", required: false, provided: false, breaks: "Sign-in is limited to the default domain in _shared/email_domain.js." },
] as const;

export type EnvName = typeof ENV_VARS[number]["name"];
export type Env = (key: string) => string | undefined;

// Keyed on the env reader, so each isolate (one reader) logs a name once and each test's
// fresh deps start clean.
const warned = new WeakMap<Env, Set<string>>();

function read(env: Env, name: EnvName): string | undefined {
  const v = env(name);
  if (v !== undefined && v.trim() !== "") return v;
  const seen = warned.get(env) ?? new Set<string>();
  warned.set(env, seen);
  if (!seen.has(name)) {
    seen.add(name);
    console.warn(`config: ${name} is not set`);
  }
  return undefined;
}

/** The value, or a 500 "misconfigured" naming the variable. */
export function requiredEnv(env: Env, name: EnvName): string {
  const v = read(env, name);
  if (v === undefined) throw new HttpError(500, "misconfigured", `${name} is not set`);
  return v;
}

/** The value, or undefined; the caller carries on without it. */
export function optionalEnv(env: Env, name: EnvName): string | undefined {
  return read(env, name);
}

/** The value, or the fallback. */
export function envOr(env: Env, name: EnvName, fallback: string): string {
  return read(env, name) ?? fallback;
}

/** Required names that are unset. Reading them logs each one. */
export function missingRequired(env: Env): EnvName[] {
  return ENV_VARS.filter((v) => v.required && read(env, v.name) === undefined).map((v) => v.name);
}
