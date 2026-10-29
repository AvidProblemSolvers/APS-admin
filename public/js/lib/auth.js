// Supabase Auth over plain fetch: emailed one-time code, no passwords.
// - sendLink() always passes create_user:false, so the interface cannot create accounts,
//   and always reports the same neutral message whatever the server says.
// - sendLink() refuses an address outside the allowed domain without calling GoTrue. That is
//   a courtesy only: every Edge Function refuses off-domain users itself (_shared/http.ts).
// - verifyCode() trades the six-digit code for a session (/verify, type "email"). A code is
//   used because mail scanners fetch every URL in a message and spend a single-use link
//   before the human clicks it; a scanner cannot type a code.
// - A link that does survive still returns tokens in the URL fragment (implicit flow); we
//   read them once and strip them from the address bar.

import { ALLOWED_EMAIL_DOMAIN, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";
import { allowedDomain, inAllowedDomain } from "../shared/email_domain.js";

const KEY = "aps-admin-session";
const base = `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
const headers = { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" };

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

function save(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: session lives for this page only */ }
  memory = s;
}

let memory = load();

/** Reads #access_token=… or #error=… left by the magic link. Returns an error message or null. */
export function consumeRedirect(loc = window.location) {
  const hash = loc.hash.startsWith("#") ? loc.hash.slice(1) : "";
  if (!/(^|&)(access_token|error)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  history.replaceState(null, "", loc.pathname + loc.search);
  if (p.get("error")) {
    return p.get("error_code") === "otp_expired"
      ? "That sign-in link has expired or was already used. Request a new one."
      : "That sign-in link did not work. Request a new one.";
  }
  saveSession({
    access_token: p.get("access_token"),
    refresh_token: p.get("refresh_token"),
    expires_at: p.get("expires_at"),
    expires_in: p.get("expires_in"),
  });
  return null;
}

function saveSession(d) {
  save({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Number(d.expires_at) || Math.floor(Date.now() / 1000) + (Number(d.expires_in) || 3600),
  });
}

export const NEUTRAL_SENT = "If that address is authorised, a sign-in code is on its way. It expires in an hour.";
export const BAD_CODE = "That code did not work. Check it, or request a new one.";
const OFFLINE = "Could not reach the sign-in service. Check your connection and try again.";

export const EMAIL_DOMAIN = allowedDomain(ALLOWED_EMAIL_DOMAIN);
export const WRONG_DOMAIN = `Use your ${EMAIL_DOMAIN} address.`;

export async function sendLink(email) {
  if (!inAllowedDomain(email, EMAIL_DOMAIN)) return WRONG_DOMAIN;
  const redirect = `${window.location.origin}/`;
  try {
    await fetch(`${base}/otp?redirect_to=${encodeURIComponent(redirect)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: email.trim().toLowerCase(), create_user: false }),
    });
  } catch {
    return OFFLINE;
  }
  // Same answer for known, unknown and inactive addresses.
  return NEUTRAL_SENT;
}

/**
 * Exchanges an emailed code for a session. Returns null on success, else a message.
 * Wrong, expired and unknown-address codes all get BAD_CODE: GoTrue answers them alike, and
 * so do we.
 */
export async function verifyCode(email, code) {
  if (!inAllowedDomain(email, EMAIL_DOMAIN)) return WRONG_DOMAIN;
  const token = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return "Enter the six-digit code from the email.";
  let res;
  try {
    res = await fetch(`${base}/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "email", email: email.trim().toLowerCase(), token }),
    });
  } catch {
    return OFFLINE;
  }
  const d = res.ok ? await res.json().catch(() => null) : null;
  if (!d?.access_token) return BAD_CODE;
  saveSession(d);
  return null;
}

async function refresh() {
  const s = memory;
  if (!s?.refresh_token) return null;
  try {
    const res = await fetch(`${base}/token?grant_type=refresh_token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) throw new Error(String(res.status));
    saveSession(await res.json());
    return memory.access_token;
  } catch {
    save(null);
    return null;
  }
}

let inflight = null;

export async function accessToken({ force = false } = {}) {
  const s = memory;
  if (!s?.access_token) return null;
  if (!force && s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  inflight ??= refresh().finally(() => (inflight = null));
  return inflight;
}

export const hasSession = () => Boolean(memory?.access_token);

export async function signOut() {
  const token = memory?.access_token;
  save(null);
  if (token) {
    await fetch(`${base}/logout`, { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` } }).catch(() => {});
  }
}
