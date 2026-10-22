// The PUBLISH control and build status, shared by Content and Settings.
// Nothing reaches the live site until this is pressed.

import { html } from "../lib/html.js";

const LABEL = {
  queued: ["Queued", "warn"],
  in_progress: ["Building", "warn"],
  success: ["Live", "ok"],
  failure: ["Build failed", "bad"],
  cancelled: ["Cancelled", "bad"],
};

export function publishStatus(p) {
  if (!p) return "";
  if (p.error) return html`<span class="pill bad">${p.error}</span>`;
  const run = p.run;
  if (!run) return html`<span class="pill warn">Dispatched — waiting for the build to start</span>`;
  const key = run.status === "completed" ? (run.conclusion || "success") : run.status;
  const [text, tone] = LABEL[key] ?? [key, "warn"];
  return html`<span class="pill ${tone}">${text}</span> <a href="${run.html_url}" target="_blank" rel="noopener noreferrer">build log</a>`;
}

export function publishButton(dirty = false) {
  return html`<button class="btn publish" type="button" data-click="publish"${dirty ? html` title="Save your changes first — Publish builds what is saved"` : ""}>PUBLISH</button>`;
}

/** Starts a publish and polls until the run completes, calling update(p) on every change. */
export async function runPublish(ctx, update) {
  let p;
  try {
    p = await ctx.api("trigger-publish", { action: "publish" });
  } catch (e) {
    update({ error: e.message });
    return;
  }
  await runPublishPoll(ctx, p, update);
}

/** Polls an already-dispatched publish (e.g. one started by saving a published answer). */
export async function runPublishPoll(ctx, p, update) {
  update(p);
  for (let i = 0; i < 120; i++) {
    if (p.run?.status === "completed") return;
    await new Promise((r) => setTimeout(r, ctx.pollMs ?? 5000));
    try {
      const s = await ctx.api("trigger-publish", p.run ? { action: "status", run_id: p.run.id } : { action: "status", since: p.dispatched_at });
      if (s.run) p = { ...p, run: s.run };
      update(p);
    } catch {
      /* keep polling */
    }
  }
}
