// Display formatting for emails. Storage stays UTC; these only render.

export const IST = "Asia/Kolkata";

export function fmtSlot(iso: string, tz: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).format(d);
  return `${date}, ${time}`;
}

/** "<their time> (<IST time>)", or just IST when their zone is unknown or is IST. */
export function fmtBoth(iso: string, tz: string | null | undefined): string {
  const ist = fmtSlot(iso, IST);
  if (!tz || tz === IST) return ist;
  return `${fmtSlot(iso, tz)} (${ist} / ${tz})`;
}

export function confirmedUrl(siteOrigin: string, paymentId: string): string {
  return `${siteOrigin.replace(/\/$/, "")}/confirmed?razorpay_payment_id=${encodeURIComponent(paymentId)}`;
}

/** Start of the current calendar month in IST, as a UTC instant. */
export function monthStartIst(now: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit" }).format(now);
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1) - 330 * 60_000); // IST is UTC+05:30, no DST
}
