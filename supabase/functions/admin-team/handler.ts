// Team pane (owner only). Invite by magic link, change role, deactivate / reactivate.
// Never delete: audit history must keep resolving to a person. The last active owner
// cannot be demoted or deactivated, and an owner cannot change their own role.

import { audit } from "../_shared/audit.ts";
import { HttpError, notFound } from "../_shared/errors.ts";
import { allowedDomain, inAllowedDomain } from "../_shared/email_domain.js";
import { str, uuid } from "../_shared/http.ts";
import type { Ctx, FunctionSpec, Role, Row } from "../_shared/types.ts";
import { ROLES } from "../_shared/types.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLUMNS = ["id", "email", "full_name", "role", "active", "invited_by", "created_at"];

function role(v: unknown): Role {
  if (!ROLES.includes(v as Role)) throw new HttpError(400, "invalid_input", "role must be owner, admin or team");
  return v as Role;
}

function adminUrl(ctx: Ctx): string {
  return (ctx.deps.env("ADMIN_ORIGIN") ?? "https://admin.avidproblemsolvers.com").split(",")[0].trim() + "/";
}

async function list(ctx: Ctx) {
  const rows = await ctx.deps.db.select("team_members", { columns: COLUMNS, order: [["created_at", "asc"]] });
  return { rows, self: ctx.actor.id };
}

async function member(ctx: Ctx, id: string): Promise<Row> {
  const [m] = await ctx.deps.db.select("team_members", { columns: COLUMNS, where: [["eq", "id", id]], limit: 1 });
  if (!m) throw notFound();
  return m;
}

async function assertAnotherOwner(ctx: Ctx, excludingId: string) {
  const owners = await ctx.deps.db.select("team_members", {
    columns: ["id"],
    where: [["eq", "role", "owner"], ["eq", "active", true], ["neq", "id", excludingId]],
  });
  if (!owners.length) throw new HttpError(409, "last_owner", "The last active owner cannot be demoted or deactivated.");
}

/** Re-checks after a write; if a concurrent change left no active owner, undo ours. */
async function undoIfOwnerless(ctx: Ctx, id: string, undo: Row) {
  const n = await ctx.deps.db.count("team_members", [["eq", "role", "owner"], ["eq", "active", true]]);
  if (n === 0) {
    await ctx.deps.db.update("team_members", [["eq", "id", id]], undo);
    throw new HttpError(409, "last_owner", "The last active owner cannot be demoted or deactivated.");
  }
}

async function invite(ctx: Ctx) {
  const email = str(ctx.body, "email", { required: true, max: 254 }).trim().toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, "invalid_input", "not an email address");
  // An off-domain member could never sign in (http.ts refuses them), so do not create one.
  const domain = allowedDomain(ctx.deps.env("ALLOWED_EMAIL_DOMAIN"));
  if (!inAllowedDomain(email, domain)) throw new HttpError(400, "invalid_input", `must be an ${domain} address`);
  const r = role(ctx.body.role);
  const full_name = str(ctx.body, "full_name", { max: 120 }).trim() || null;
  const { db, auth } = ctx.deps;

  const [existing] = await db.select("team_members", { columns: ["id", "active"], where: [["eq", "email", email]], limit: 1 });
  if (existing) {
    throw new HttpError(409, "already_member", existing.active ? "Already on the team." : "Already a member — reactivate them instead.");
  }

  let user;
  try {
    user = await auth.inviteUser(email, adminUrl(ctx));
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 409) throw e;
    // They already have an auth account (e.g. created by hand): link it and send a magic link.
    user = await auth.findUserByEmail(email);
    if (!user) throw new HttpError(502, "auth_failed", "Could not resolve the existing account.");
    await auth.setBanned(user.id, false);
    await auth.sendMagicLink(email, adminUrl(ctx));
  }
  const [row] = await db.insert("team_members", {
    id: user.id, email, full_name, role: r, active: true, invited_by: ctx.actor.id,
  });
  await audit(ctx, { action: "team.invite", target: email, new_value: { role: r, full_name } });
  return { member: row };
}

async function setRole(ctx: Ctx) {
  const id = uuid(ctx.body, "member_id");
  const next = role(ctx.body.role);
  if (id === ctx.actor.id) throw new HttpError(409, "own_role", "An owner cannot change their own role.");
  const m = await member(ctx, id);
  if (m.role === next) return { member: m };
  if (m.role === "owner" && m.active) await assertAnotherOwner(ctx, id);
  const [row] = await ctx.deps.db.update("team_members", [["eq", "id", id]], { role: next });
  if (m.role === "owner") await undoIfOwnerless(ctx, id, { role: m.role });
  await audit(ctx, { action: "team.role", target: String(m.email), old_value: m.role, new_value: next });
  return { member: row };
}

async function setActive(ctx: Ctx) {
  const id = uuid(ctx.body, "member_id");
  if (typeof ctx.body.active !== "boolean") throw new HttpError(400, "invalid_input", "active must be true or false");
  const active = ctx.body.active;
  if (id === ctx.actor.id) throw new HttpError(409, "own_account", "You cannot deactivate yourself.");
  const m = await member(ctx, id);
  if (m.active === active) return { member: m };
  if (!active && m.role === "owner") await assertAnotherOwner(ctx, id);
  const [row] = await ctx.deps.db.update("team_members", [["eq", "id", id]], { active });
  if (!active && m.role === "owner") await undoIfOwnerless(ctx, id, { active: true });
  // Defence in depth: a banned auth user cannot complete a magic-link sign-in at all.
  await ctx.deps.auth.setBanned(id, !active).catch(() => {});
  await audit(ctx, {
    action: active ? "team.reactivate" : "team.deactivate",
    target: String(m.email),
    old_value: { active: m.active },
    new_value: { active },
  });
  return { member: row };
}

async function resendLink(ctx: Ctx) {
  const id = uuid(ctx.body, "member_id");
  const m = await member(ctx, id);
  if (!m.active) throw new HttpError(409, "inactive", "Reactivate them first.");
  await ctx.deps.auth.sendMagicLink(String(m.email), adminUrl(ctx));
  await audit(ctx, { action: "team.resend_link", target: String(m.email) });
  return { ok: true };
}

export const spec: FunctionSpec = {
  name: "admin-team",
  actions: {
    list: { roles: ["owner"], run: list },
    invite: { roles: ["owner"], run: invite },
    set_role: { roles: ["owner"], run: setRole },
    set_active: { roles: ["owner"], run: setActive },
    resend_link: { roles: ["owner"], run: resendLink },
  },
};
