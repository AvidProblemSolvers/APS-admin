// Shared types for every admin Edge Function. Erasable syntax only: Node strips these
// types in tests, Deno checks them in production.

export type Role = "owner" | "admin" | "team";
export const ROLES: Role[] = ["owner", "admin", "team"];

export type Row = Record<string, unknown>;
export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "ilike" | "is" | "in";
export type Where = [Op, string, unknown][];

export interface SelectOpts {
  columns?: string[];
  where?: Where;
  order?: [string, "asc" | "desc"][];
  limit?: number;
  offset?: number;
}

export interface Db {
  select(table: string, opts?: SelectOpts): Promise<Row[]>;
  selectAll(table: string, opts?: SelectOpts): Promise<Row[]>;
  count(table: string, where?: Where): Promise<number>;
  insert(table: string, rows: Row | Row[]): Promise<Row[]>;
  update(table: string, where: Where, patch: Row): Promise<Row[]>;
  delete(table: string, where: Where): Promise<Row[]>;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthAdmin {
  getUser(accessToken: string): Promise<AuthUser | null>;
  /** Creates the auth user and emails an invite. Throws HttpError 409 if already registered. */
  inviteUser(email: string, redirectTo: string): Promise<AuthUser>;
  /** Looks up (or creates nothing for) an existing auth user by email. */
  findUserByEmail(email: string): Promise<AuthUser | null>;
  /** Emails a magic link to an existing user. Never creates a user. */
  sendMagicLink(email: string, redirectTo: string): Promise<void>;
  setBanned(userId: string, banned: boolean): Promise<void>;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}

export interface GitHub {
  dispatch(eventType: string, payload: Row): Promise<void>;
  runsSince(sinceIso: string): Promise<WorkflowRun[]>;
  run(id: number): Promise<WorkflowRun | null>;
}

export interface Meetings {
  /** Calls the site's create-meeting Edge Function for a booking whose slot is set. */
  create(bookingId: string): Promise<{ meet_link: string | null }>;
}

export interface Storage {
  signedUrl(bucket: string, path: string, expiresIn: number): Promise<string>;
}

export interface Deps {
  db: Db;
  auth: AuthAdmin;
  mailer: Mailer;
  github: GitHub;
  meetings: Meetings;
  storage: Storage;
  env: (key: string) => string | undefined;
  now: () => Date;
}

export interface Actor {
  id: string;
  email: string;
  role: Role;
  full_name: string | null;
  country: string | null;
}

export interface Ctx {
  actor: Actor;
  deps: Deps;
  body: Row;
}

export interface Action {
  roles: Role[];
  run: (ctx: Ctx) => Promise<unknown>;
}

export interface FunctionSpec {
  name: string;
  actions: Record<string, Action>;
}
