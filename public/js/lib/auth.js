// Supabase Auth over plain fetch: magic link only.
// - sendLink() always passes create_user:false, so the interface cannot create accounts,
//   and always reports the same neutral message whatever the server says.
// - The magic link returns tokens in the URL fragment (implicit flow); we read them once
//   and strip them from the address bar.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";

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
  const expiresIn = Number(p.get("expires_in") || 3600);
  save({
    access_token: p.get("access_token"),
    refresh_token: p.get("refresh_token"),
    expires_at: Number(p.get("expires_at")) || Math.floor(Date.now() / 1000) + expiresIn,
  });
  return null;
}

export const NEUTRAL_SENT = "If that address is authorised, a sign-in link is on its way. It expires in an hour.";

export async function sendLink(email) {
  const redirect = `${window.location.origin}/`;
  try {
    await fetch(`${base}/otp?redirect_to=${encodeURIComponent(redirect)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: email.trim().toLowerCase(), create_user: false }),
    });
  } catch {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }
  // Same answer for known, unknown and inactive addresses.
  return NEUTRAL_SENT;
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
    const d = await res.json();
    save({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    });
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
