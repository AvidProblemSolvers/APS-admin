// Answers pane: list, create and edit answer pages. Publishing (or changing or
// unpublishing a published answer) triggers a site rebuild.

import { audit } from "../_shared/audit.ts";
import { HttpError, notFound } from "../_shared/errors.ts";
import { str } from "../_shared/http.ts";
import { publishSite } from "../_shared/publish.ts";
import type { Ctx, FunctionSpec, Row } from "../_shared/types.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS = ["title", "slug", "summary", "body_md", "question", "related", "published"] as const;

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

async function list(ctx: Ctx) {
  const rows = await ctx.deps.db.selectAll("answers", { order: [["updated_at", "desc"]] });
  return { rows };
}

function clean(body: Row): Row {
  const title = str(body, "title", { required: true, max: 200 }).trim();
  const slug = str(body, "slug", { required: true, max: 120 }).trim();
  if (!SLUG.test(slug)) throw new HttpError(400, "invalid_input", "slug: lowercase letters, digits and single hyphens");
  const summary = str(body, "summary", { required: true, max: 1200 }).trim();
  const body_md = str(body, "body_md", { required: true, max: 100_000 });
  const question = str(body, "question", { max: 300 }).trim() || null;
  const related = body.related ?? [];
  if (!Array.isArray(related) || related.length > 20 || related.some((r) => typeof r !== "string" || !SLUG.test(r))) {
    throw new HttpError(400, "invalid_input", "related must be a list of slugs");
  }
  if ((related as string[]).includes(slug)) throw new HttpError(400, "invalid_input", "an answer cannot relate to itself");
  return { title, slug, summary, body_md, question, related: [...new Set(related as string[])], published: body.published === true };
}

async function save(ctx: Ctx) {
  const { db, now } = ctx.deps;
  const next = clean(ctx.body);
  const id = ctx.body.id ? String(ctx.body.id) : null;
  const stamp = now().toISOString();

  let before: Row | null = null;
  let saved: Row;
  if (id) {
    [before] = await db.select("answers", { where: [["eq", "id", id]], limit: 1 });
    if (!before) throw notFound();
    [saved] = await db.update("answers", [["eq", "id", id]], { ...next, updated_at: stamp });
  } else {
    [saved] = await db.insert("answers", { ...next, created_at: stamp, updated_at: stamp });
  }

  const changed = FIELDS.filter((f) => JSON.stringify(before?.[f] ?? null) !== JSON.stringify(next[f] ?? null));
  if (changed.length) {
    const pick = (r: Row | null) => r ? Object.fromEntries(changed.map((f) => [f, r[f]])) : null;
    await audit(ctx, {
      action: before ? "answer.update" : "answer.create",
      target: String(next.slug),
      old_value: pick(before),
      new_value: pick(next),
    });
  }

  const words = wordCount(String(next.summary));
  const warnings: string[] = [];
  if (words < 40 || words > 60) warnings.push(`Summary is ${words} words; answer engines quote 40–60.`);

  // A rebuild is needed whenever what is (or was) live changes.
  let publish = null;
  if (changed.length && (next.published === true || before?.published === true)) {
    try {
      publish = await publishSite(ctx, `answer:${next.slug}`);
    } catch {
      warnings.push("Saved, but the rebuild could not be started. Press Publish on the Content tab.");
    }
  }
  return { answer: saved, changed, warnings, publish };
}

export const spec: FunctionSpec = {
  name: "admin-answers",
  actions: {
    list: { roles: ["owner", "admin"], run: list },
    save: { roles: ["owner", "admin"], run: save },
  },
};
