// Production adapters: GoTrue, Resend, GitHub, the site's create-meeting function and
// Supabase Storage, all over fetch. Only index.ts files construct these.

import { guardDb, postgrestDb } from "./db.ts";
import { HttpError } from "./errors.ts";
import type { AuthAdmin, AuthUser, Deps, GitHub, Mailer, Meetings, Storage, WorkflowRun } from "./types.ts";

type Env = (key: string) => string | undefined;

function need(env: Env, key: string): string {
  const v = env(key);
  if (!v) throw new HttpError(500, "misconfigured", `${key} is not set`);
  return v;
}

export function gotrue(url: string, serviceKey: string, f: typeof fetch = fetch): AuthAdmin {
  const base = `${url.replace(/\/$/, "")}/auth/v1`;
  const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const asUser = (u: { id?: string; email?: string }): AuthUser => ({ id: String(u.id), email: String(u.email) });

  return {
    async getUser(token) {
      const res = await f(`${base}/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const u = await res.json();
      return u?.id && u?.email ? asUser(u) : null;
    },
    async inviteUser(email, redirectTo) {
      const res = await f(`${base}/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST", headers: admin, body: JSON.stringify({ email }),
      });
      if (res.status === 422 || res.status === 409) throw new HttpError(409, "already_registered");
      if (!res.ok) throw new HttpError(502, "auth_failed", `invite failed (${res.status})`);
      return asUser(await res.json());
    },
    async findUserByEmail(email) {
      // generate_link returns the existing user without sending anything.
      const res = await f(`${base}/admin/generate_link`, {
        method: "POST", headers: admin, body: JSON.stringify({ type: "magiclink", email }),
      });
      if (!res.ok) return null;
      const u = await res.json();
      return u?.id ? asUser({ id: u.id, email: u.email ?? email }) : null;
    },
    async sendMagicLink(email, redirectTo) {
      const res = await f(`${base}/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: "POST", headers: admin, body: JSON.stringify({ email, create_user: false }),
      });
      if (!res.ok) throw new HttpError(502, "auth_failed", `magic link failed (${res.status})`);
    },
    async setBanned(userId, banned) {
      const res = await f(`${base}/admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT", headers: admin, body: JSON.stringify({ ban_duration: banned ? "876000h" : "none" }),
      });
      if (!res.ok) throw new HttpError(502, "auth_failed", `ban update failed (${res.status})`);
    },
  };
}

export function resend(env: Env, f: typeof fetch = fetch): Mailer {
  return {
    async send(m) {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${need(env, "RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: need(env, "MAIL_FROM"),
          to: [m.to],
          subject: m.subject,
          text: m.text,
          reply_to: m.replyTo ?? env("OWNER_EMAIL"),
        }),
      });
      if (!res.ok) throw new HttpError(502, "mail_failed", `Resend returned ${res.status}`);
    },
  };
}

export function github(env: Env, f: typeof fetch = fetch): GitHub {
  const api = () => `https://api.github.com/repos/${need(env, "GITHUB_SITE_REPO")}`;
  const headers = () => ({
    Authorization: `Bearer ${need(env, "GITHUB_PAT")}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "aps-admin",
  });
  const run = (r: Record<string, unknown>): WorkflowRun => ({
    id: Number(r.id),
    status: String(r.status),
    conclusion: (r.conclusion as string | null) ?? null,
    html_url: String(r.html_url),
    created_at: String(r.created_at),
  });
  return {
    async dispatch(eventType, payload) {
      const res = await f(`${api()}/dispatches`, {
        method: "POST", headers: headers(), body: JSON.stringify({ event_type: eventType, client_payload: payload }),
      });
      if (res.status !== 204) throw new HttpError(502, "publish_failed", `GitHub returned ${res.status}`);
    },
    async runsSince(sinceIso) {
      const q = new URLSearchParams({ event: "repository_dispatch", per_page: "10", created: `>=${sinceIso}` });
      const res = await f(`${api()}/actions/runs?${q}`, { headers: headers() });
      if (!res.ok) throw new HttpError(502, "publish_failed", `GitHub returned ${res.status}`);
      const data = await res.json();
      return (data.workflow_runs ?? []).map(run);
    },
    async run(id) {
      const res = await f(`${api()}/actions/runs/${id}`, { headers: headers() });
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpError(502, "publish_failed", `GitHub returned ${res.status}`);
      return run(await res.json());
    },
  };
}

export function meetings(url: string, serviceKey: string, f: typeof fetch = fetch): Meetings {
  return {
    async create(bookingId) {
      const res = await f(`${url.replace(/\/$/, "")}/functions/v1/create-meeting`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId }),
      });
      if (!res.ok) throw new HttpError(502, "meeting_failed", `create-meeting returned ${res.status}`);
      const data = await res.json().catch(() => ({}));
      return { meet_link: data.meet_link ?? null };
    },
  };
}

export function storage(url: string, serviceKey: string, f: typeof fetch = fetch): Storage {
  const base = `${url.replace(/\/$/, "")}/storage/v1`;
  return {
    async signedUrl(bucket, path, expiresIn) {
      const clean = path.split("/").map(encodeURIComponent).join("/");
      const res = await f(`${base}/object/sign/${encodeURIComponent(bucket)}/${clean}`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      });
      if (!res.ok) throw new HttpError(502, "storage_failed");
      const data = await res.json();
      return `${base}${data.signedURL ?? data.signedUrl}`;
    },
  };
}

export function prodDeps(env: Env): Deps {
  const url = env("SUPABASE_URL") ?? "";
  const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return {
    db: guardDb(postgrestDb(url, key)),
    auth: gotrue(url, key),
    mailer: resend(env),
    github: github(env),
    meetings: meetings(url, key),
    storage: storage(url, key),
    env,
    now: () => new Date(),
  };
}
