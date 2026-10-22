// Slot generation per SPEC §6.3, so the Availability pane can show the next N days exactly
// as a visitor would see them. Inputs are rows; output is UTC ISO strings. Pure.

import type { Row } from "./types.ts";

export interface SchedulerSettings {
  timezone: string;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  windowDays: number;
}

export function schedulerSettings(values: Record<string, string>): SchedulerSettings {
  const n = (k: string, d: number) => (/^\d+$/.test(values[k] ?? "") ? Number(values[k]) : d);
  return {
    timezone: values.scheduler_timezone || "Asia/Kolkata",
    slotMinutes: n("scheduler_slot_minutes", 60),
    bufferMinutes: n("scheduler_buffer_minutes", 15),
    minNoticeHours: n("scheduler_min_notice_hours", 24),
    windowDays: n("scheduler_window_days", 30),
  };
}

const MIN = 60_000;
const DAY = 86_400_000;

/** Minutes east of UTC for `tz` at the instant `utcMs`. */
export function tzOffset(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const p: Record<string, number> = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MIN);
}

/** Wall-clock date + time in `tz` → UTC epoch ms. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm || 0, ss || 0);
  const first = guess - tzOffset(guess, tz) * MIN;
  const second = guess - tzOffset(first, tz) * MIN;
  return second;
}

/** Calendar date (YYYY-MM-DD) in `tz` at `utcMs`. */
export function localDate(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(utcMs));
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, matching JavaScript's getUTCDay(). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

type Interval = [number, number];

export function generateSlots(input: {
  rules: Row[];
  overrides: Row[];
  booked: Row[];
  settings: SchedulerSettings;
  now: Date;
}): string[] {
  const { rules, overrides, booked, settings: s, now } = input;
  const nowMs = now.getTime();
  const earliest = nowMs + s.minNoticeHours * 60 * MIN;
  const latest = nowMs + s.windowDays * DAY;
  const len = s.slotMinutes * MIN;
  const step = (s.slotMinutes + s.bufferMinutes) * MIN;
  const buffer = s.bufferMinutes * MIN;

  const windows: Interval[] = [];
  const blocks: Interval[] = [];

  for (const r of rules) {
    if (r.active === false || r.start_time == null || r.end_time == null) continue;
    const tz = String(r.timezone || s.timezone);
    const first = addDays(localDate(nowMs, tz), -1);
    for (let i = 0; i <= s.windowDays + 1; i++) {
      const date = addDays(first, i);
      if (weekdayOf(date) !== Number(r.weekday)) continue;
      windows.push([zonedToUtc(date, String(r.start_time), tz), zonedToUtc(date, String(r.end_time), tz)]);
    }
  }

  for (const o of overrides) {
    const date = String(o.date);
    const tz = s.timezone;
    const whole: Interval = [zonedToUtc(date, "00:00", tz), zonedToUtc(addDays(date, 1), "00:00", tz)];
    const span: Interval = o.start_time && o.end_time
      ? [zonedToUtc(date, String(o.start_time), tz), zonedToUtc(date, String(o.end_time), tz)]
      : whole;
    if (o.kind === "block") blocks.push(span);
    else if (o.kind === "extra" && o.start_time && o.end_time) windows.push(span);
  }

  for (const b of booked) {
    if (!b.slot_start || b.status === "cancelled") continue;
    const start = Date.parse(String(b.slot_start));
    const end = b.slot_end ? Date.parse(String(b.slot_end)) : start + len;
    blocks.push([start - buffer, end + buffer]);
  }

  const out = new Set<number>();
  for (const [ws, we] of windows) {
    for (let t = ws; t + len <= we; t += step) {
      if (t < earliest || t >= latest) continue;
      if (blocks.some(([bs, be]) => t < be && bs < t + len)) continue;
      out.add(t);
    }
  }
  return [...out].sort((a, b) => a - b).map((t) => new Date(t).toISOString());
}
