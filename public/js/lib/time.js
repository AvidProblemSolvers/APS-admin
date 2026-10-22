// Display-only time formatting. Everything arrives as UTC ISO strings.

export const IST = "Asia/Kolkata";
export const VIEWER_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

function f(iso, tz, opts) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }).format(new Date(iso));
}

export function dateTime(iso, tz = IST) {
  if (!iso) return "";
  return `${f(iso, tz, { day: "numeric", month: "short" })} ${f(iso, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

export function dateTimeLong(iso, tz = IST) {
  if (!iso) return "";
  return `${f(iso, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${f(iso, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

export function day(iso, tz = IST) {
  return f(iso, tz, { weekday: "short", day: "numeric", month: "short" });
}

export function clock(iso, tz = IST) {
  return f(iso, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function tzAbbr(iso, tz) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(iso));
  return p.find((x) => x.type === "timeZoneName")?.value ?? tz;
}

export function localDate(iso, tz = IST) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function hoursSince(iso, now = Date.now()) {
  return Math.floor((now - Date.parse(iso)) / 3_600_000);
}

export function ago(iso, now = Date.now()) {
  const h = hoursSince(iso, now);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** True when `tz` shows the same wall-clock as IST at that instant (e.g. Asia/Calcutta). */
export function sameAsIst(iso, tz) {
  try {
    return dateTimeLong(iso, tz) === dateTimeLong(iso, IST);
  } catch {
    return false;
  }
}
