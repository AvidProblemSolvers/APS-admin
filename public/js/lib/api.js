// Calls an admin Edge Function. The browser sends only its access token and the action;
// it never sends a role. Every response is authorised again on the server.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";
import { accessToken } from "./auth.js";

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error || "error";
    this.body = body || {};
  }
}

const listeners = new Set();
/** Called with "not_authorised" when the server says this user has no access. */
export const onAuthLost = (fn) => listeners.add(fn);

async function raw(fn, body, retried = false) {
  const token = await accessToken();
  if (!token) {
    listeners.forEach((l) => l("signed_out"));
    throw new ApiError(401, { error: "signed_out" });
  }
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/${fn}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    await accessToken({ force: true });
    return raw(fn, body, true);
  }
  return res;
}

export async function api(fn, body) {
  const res = await raw(fn, body);
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 403 && data?.error === "not_authorised") listeners.forEach((l) => l("not_authorised"));
    throw new ApiError(res.status, isJson ? data : { error: "error" });
  }
  return data;
}

/** For CSV exports: fetches and saves the file. */
export async function download(fn, body) {
  const res = await raw(fn, body);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "export.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
