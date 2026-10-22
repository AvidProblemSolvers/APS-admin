// Publish = fire repository_dispatch at the SITE repo, then find the run it started so
// the admin can poll it. Shared by trigger-publish, admin-answers and admin-settings.

import { audit } from "./audit.ts";
import type { Ctx, WorkflowRun } from "./types.ts";

export interface PublishResult {
  dispatched_at: string;
  run: WorkflowRun | null;
}

export async function publishSite(ctx: Ctx, reason: string): Promise<PublishResult> {
  const dispatched_at = new Date(ctx.deps.now().getTime() - 5_000).toISOString();
  await ctx.deps.github.dispatch("publish", { by: ctx.actor.email, reason });
  await audit(ctx, { action: "site.publish", target: reason });
  const runs = await ctx.deps.github.runsSince(dispatched_at).catch(() => []);
  return { dispatched_at, run: runs.at(-1) ?? null };
}

export async function publishStatus(ctx: Ctx, runId: number | null, since: string | null) {
  if (runId) return { run: await ctx.deps.github.run(runId) };
  if (since) {
    const runs = await ctx.deps.github.runsSince(since);
    return { run: runs.at(-1) ?? null };
  }
  return { run: null };
}
