// The only way any admin code touches audit_log for writing: one INSERT. There is no
// update or delete helper here, and guardDb() refuses both even if someone writes one.

import type { Ctx } from "./types.ts";

export interface AuditEntry {
  action: string;
  target?: string | null;
  old_value?: unknown;
  new_value?: unknown;
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

export async function audit(ctx: Ctx, e: AuditEntry): Promise<void> {
  await ctx.deps.db.insert("audit_log", {
    actor_id: ctx.actor.id,
    actor_email: ctx.actor.email,
    action: e.action,
    target: e.target ?? null,
    old_value: text(e.old_value),
    new_value: text(e.new_value),
    actor_country: ctx.actor.country,
    created_at: ctx.deps.now().toISOString(),
  });
}
