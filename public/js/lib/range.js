// FROM/TO date filters, shared by Audit, Signals and Traffic: one markup, one conversion.
// Dates are IST calendar days ("YYYY-MM-DD"); the server receives UTC instants.

import { html } from "./html.js";
import { IST, localDate } from "./time.js";

const DAY = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Longest custom range Traffic will load. */
export const MAX_DAYS = 366;

/** The two date inputs, named from and to. */
export function dateFields(f) {
  return html`<label class="field"><span class="label">From</span><input type="date" name="from" value="${f.from ?? ""}"></label>
        <label class="field"><span class="label">To</span><input type="date" name="to" value="${f.to ?? ""}"></label>`;
}

/** FROM's IST midnight and the IST midnight after TO (exclusive), as UTC ISO. Either may be absent. */
export function istDayRange(from, to) {
  const out = {};
  if (from) out.from = new Date(`${from}T00:00:00+05:30`).toISOString();
  if (to) out.to = new Date(Date.parse(`${to}T00:00:00+05:30`) + DAY).toISOString();
  return out;
}

/** Today as an IST calendar date. */
export const istToday = (now = Date.now()) => localDate(new Date(now).toISOString(), IST);

/** Inclusive length in days of a FROM/TO pair. */
export const spanDays = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

/** Why a FROM/TO pair cannot be loaded, in plain words; "" when it can. */
export function rangeProblem(from, to, today = istToday()) {
  if (!from || !to) return "Pick both a FROM and a TO date.";
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return "Those are not valid dates.";
  if (to < from) return "TO is before FROM. Pick an end date on or after the start date.";
  if (to > today) return `The range runs into the future. Pick dates up to today (${today}, IST).`;
  if (spanDays(from, to) > MAX_DAYS) return `Pick a range of ${MAX_DAYS} days or fewer.`;
  return "";
}
