// Fakes for everything outside the database. Nothing here touches the network.

import { guardDb } from "../supabase/functions/_shared/db.ts";
import { HttpError } from "../supabase/functions/_shared/errors.ts";
import type {
  AuthAdmin, AuthUser, Deps, GitHub, Mail, Mailer, Meetings, Row, Storage, WorkflowRun,
} from "../supabase/functions/_shared/types.ts";
import { MemoryDb } from "./memory_db.ts";

export class FakeAuth implements AuthAdmin {
  users = new Map<string, AuthUser>(); // by id
  tokens = new Map<string, string>(); // token → user id
  banned = new Set<string>();
  magicLinks: { email: string; redirectTo: string }[] = [];
  invites: { email: string; redirectTo: string }[] = [];

  addUser(u: AuthUser) {
    this.users.set(u.id, u);
    this.tokens.set(`token-${u.id}`, u.id);
  }
  tokenFor(id: string) {
    return `token-${id}`;
  }
  async getUser(token: string) {
    const id = this.tokens.get(token);
    return id ? this.users.get(id) ?? null : null;
  }
  async inviteUser(email: string, redirectTo: string) {
    if ([...this.users.values()].some((u) => u.email === email)) throw new HttpError(409, "already_registered");
    const u = { id: crypto.randomUUID(), email };
    this.addUser(u);
    this.invites.push({ email, redirectTo });
    return u;
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async sendMagicLink(email: string, redirectTo: string) {
    this.magicLinks.push({ email, redirectTo });
  }
  async setBanned(id: string, banned: boolean) {
    if (banned) this.banned.add(id);
    else this.banned.delete(id);
  }
}

export class FakeMailer implements Mailer {
  sent: Mail[] = [];
  fail = false;
  async send(m: Mail) {
    if (this.fail) throw new HttpError(502, "mail_failed");
    this.sent.push(m);
  }
}

export class FakeGitHub implements GitHub {
  dispatches: { eventType: string; payload: Row }[] = [];
  runs: WorkflowRun[] = [];
  now: () => Date;
  constructor(now: () => Date) {
    this.now = now;
  }
  async dispatch(eventType: string, payload: Row) {
    this.dispatches.push({ eventType, payload });
    this.runs.unshift({
      id: 1000 + this.runs.length,
      status: "queued",
      conclusion: null,
      html_url: `https://github.example/runs/${1000 + this.runs.length}`,
      created_at: this.now().toISOString(),
    });
  }
  async runsSince(since: string) {
    return this.runs.filter((r) => r.created_at >= since);
  }
  async run(id: number) {
    const r = this.runs.find((x) => x.id === id);
    if (!r) return null;
    // Each poll advances the fake build one step so the UI shows progress.
    if (r.status === "queued") r.status = "in_progress";
    else if (r.status === "in_progress") Object.assign(r, { status: "completed", conclusion: "success" });
    return { ...r };
  }
}

export class FakeMeetings implements Meetings {
  db: MemoryDb;
  created: string[] = [];
  constructor(db: MemoryDb) {
    this.db = db;
  }
  async create(bookingId: string) {
    this.created.push(bookingId);
    const link = `https://meet.google.com/mock-${bookingId.slice(0, 4)}`;
    const b = this.db.tables.bookings.find((x) => x.id === bookingId);
    if (b) Object.assign(b, { meet_link: link, calendar_event_id: `evt-${bookingId.slice(0, 8)}` });
    return { meet_link: link };
  }
}

export class FakeStorage implements Storage {
  async signedUrl(bucket: string, path: string, expiresIn: number) {
    return `https://storage.example/${bucket}/${path}?expires=${expiresIn}`;
  }
}

export interface TestDeps extends Deps {
  mem: MemoryDb;
  fakeAuth: FakeAuth;
  fakeMail: FakeMailer;
  fakeGitHub: FakeGitHub;
  fakeMeetings: FakeMeetings;
}

export function makeDeps(seed: Record<string, Row[]>, opts: { now?: () => Date; env?: Record<string, string> } = {}): TestDeps {
  const now = opts.now ?? (() => new Date());
  const mem = new MemoryDb(seed, now);
  const fakeAuth = new FakeAuth();
  for (const m of seed.team_members ?? []) fakeAuth.addUser({ id: String(m.id), email: String(m.email) });
  const fakeMail = new FakeMailer();
  const fakeGitHub = new FakeGitHub(now);
  const fakeMeetings = new FakeMeetings(mem);
  const env: Record<string, string> = {
    ADMIN_ORIGIN: "https://admin.avidproblemsolvers.com,http://localhost:8001",
    SITE_ORIGIN: "https://avidproblemsolvers.com",
    OWNER_EMAIL: "owner@avidproblemsolvers.com",
    BRIEF_BUCKET: "briefs",
    ...opts.env,
  };
  return {
    db: guardDb(mem),
    auth: fakeAuth,
    mailer: fakeMail,
    github: fakeGitHub,
    meetings: fakeMeetings,
    storage: new FakeStorage(),
    env: (k) => env[k],
    now,
    mem,
    fakeAuth,
    fakeMail,
    fakeGitHub,
    fakeMeetings,
  };
}
