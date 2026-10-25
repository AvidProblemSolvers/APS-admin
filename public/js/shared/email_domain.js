// The one place the admin's email domain is written. Plain JS so the browser can import a
// byte-identical copy (build.py syncs it to public/js/shared/; check.py fails on drift).
// The server reads ALLOWED_EMAIL_DOMAIN and falls back to the default here; the browser gets
// the same variable through config.js. The browser check is a courtesy — http.ts is the gate.

export const DEFAULT_EMAIL_DOMAIN = "@avidproblemsolvers.com";

/** Normalises "example.com", " @Example.com " → "@example.com"; blank → the default. */
export function allowedDomain(raw) {
  const d = String(raw ?? "").trim().toLowerCase().replace(/^@/, "");
  return d ? `@${d}` : DEFAULT_EMAIL_DOMAIN;
}

/** True only for a single-@ address whose domain is exactly the allowed one (no subdomains). */
export function inAllowedDomain(email, domain) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  return at > 0 && at === e.lastIndexOf("@") && e.slice(at) === allowedDomain(domain);
}
