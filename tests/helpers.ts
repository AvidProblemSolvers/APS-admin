import { makeDeps, type TestDeps } from "../mock/fakes.ts";
import { FUNCTIONS } from "../mock/functions.ts";
import { IDS, NOW, seed } from "../mock/seed.ts";
import { serve } from "../supabase/functions/_shared/http.ts";
import type { Row } from "../supabase/functions/_shared/types.ts";

export { FUNCTIONS, IDS, NOW };

export type Who = "owner" | "admin" | "team" | "inactive" | "stranger" | "newcomer" | "outsider" | "anonymous";

export function fresh(env: Record<string, string> = {}): TestDeps {
  const deps = makeDeps(seed(), { now: () => new Date(NOW), env });
  // Signed-in Supabase users who are not on the team at all: one off-domain, one on-domain.
  deps.fakeAuth.addUser({ id: IDS.stranger, email: "stranger@example.com" });
  deps.fakeAuth.addUser({ id: IDS.newcomer, email: "newcomer@avidproblemsolvers.com" });
  return deps;
}

/** An off-domain account with an ACTIVE owner row — the domain lock must still refuse it. */
export function withOutsider(deps: TestDeps, email = "boss@example.com"): TestDeps {
  deps.mem.tables.team_members.push({
    id: IDS.outsider, email, full_name: "Off Domain", role: "owner", active: true, created_at: "2026-01-01T00:00:00Z",
  });
  deps.fakeAuth.addUser({ id: IDS.outsider, email });
  return deps;
}

export function tokenFor(who: Who): string | null {
  if (who === "anonymous") return null;
  if (!(who in IDS)) return `token-${who}`;
  return `token-${IDS[who as keyof typeof IDS]}`;
}

export interface Result {
  status: number;
  text: string;
  json: Row;
  headers: Headers;
}

export async function call(deps: TestDeps, fn: string, who: Who, body: Row, init: { origin?: string; country?: string } = {}): Promise<Result> {
  const spec = FUNCTIONS[fn];
  if (!spec) throw new Error(`no such function ${fn}`);
  const headers: Record<string, string> = { "content-type": "application/json", origin: init.origin ?? "https://admin.avidproblemsolvers.com" };
  const t = tokenFor(who);
  if (t) headers.authorization = `Bearer ${t}`;
  if (init.country) headers["cf-ipcountry"] = init.country;
  const res = await serve(spec, new Request(`https://x.supabase.co/functions/v1/${fn}`, {
    method: "POST", headers, body: JSON.stringify(body),
  }), deps);
  const text = await res.text();
  let json: Row = {};
  try {
    json = JSON.parse(text);
  } catch { /* CSV */ }
  return { status: res.status, text, json, headers: res.headers };
}

/** audit_log rows inserted through the data layer (not by the emulated DB trigger). */
export function auditInserts(deps: TestDeps): number {
  return deps.mem.log.filter((l) => l.table === "audit_log" && l.verb === "insert").length;
}
