// Environment variables: read only through the config helpers, logged by name when unset.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prodDeps, resend } from "../supabase/functions/_shared/adapters.ts";
import { ENV_VARS, envOr, missingRequired, optionalEnv, requiredEnv } from "../supabase/functions/_shared/config.ts";
import { HttpError } from "../supabase/functions/_shared/errors.ts";

function capture<T>(fn: () => T): { out: T; lines: string[] } {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    return { out: fn(), lines };
  } finally {
    console.warn = orig;
  }
}

const reader = (vals: Record<string, string>) => (k: string) => vals[k];

describe("config helpers", () => {
  it("requiredEnv throws a 500 naming the variable, and logs it", () => {
    const env = reader({});
    const { lines } = capture(() => {
      assert.throws(() => requiredEnv(env, "MAIL_FROM"), (e) => e instanceof HttpError && e.status === 500 && e.message === "MAIL_FROM is not set");
    });
    assert.deepEqual(lines, ["config: MAIL_FROM is not set"]);
  });

  it("optionalEnv and envOr carry on, logging once per name per reader", () => {
    const env = reader({ SITE_ORIGIN: "  " });
    const { out, lines } = capture(() => [
      optionalEnv(env, "OWNER_EMAIL"), optionalEnv(env, "OWNER_EMAIL"), envOr(env, "SITE_ORIGIN", "https://x"),
    ]);
    assert.deepEqual(out, [undefined, undefined, "https://x"]);
    assert.deepEqual(lines, ["config: OWNER_EMAIL is not set", "config: SITE_ORIGIN is not set"]);
  });

  it("returns set values untouched and logs nothing", () => {
    const env = reader({ MAIL_FROM: "APS <hello@avidproblemsolvers.com>" });
    const { out, lines } = capture(() => requiredEnv(env, "MAIL_FROM"));
    assert.equal(out, "APS <hello@avidproblemsolvers.com>");
    assert.deepEqual(lines, []);
  });

  it("missingRequired lists exactly the unset required names", () => {
    const all = Object.fromEntries(ENV_VARS.map((v) => [v.name, "x"]));
    delete all.MAIL_FROM;
    delete all.OWNER_EMAIL;
    const { out } = capture(() => missingRequired(reader(all)));
    assert.deepEqual(out, ["MAIL_FROM"]);
  });

  it("prodDeps boots with nothing set and logs every missing required variable", () => {
    const { lines } = capture(() => prodDeps(reader({})));
    assert.deepEqual(lines, ENV_VARS.filter((v) => v.required).map((v) => `config: ${v.name} is not set`));
  });

  it("the mailer fails with a named misconfiguration before calling Resend when MAIL_FROM is unset", async () => {
    let called = false;
    const f = (async () => (called = true, new Response(null))) as unknown as typeof fetch;
    const mailer = resend(reader({ RESEND_API_KEY: "k" }), f);
    await assert.rejects(capture(() => mailer.send({ to: "a@b.c", subject: "s", text: "t" })).out, /MAIL_FROM is not set/);
    assert.equal(called, false);
  });
});
