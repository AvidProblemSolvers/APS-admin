// site_settings keys the admin manages, with one validator per key.
// Plain JS on purpose: the Edge Function enforces it and build.py ships the same file to
// the browser for instant feedback. The server is the authority; the browser is a courtesy.
// Values are stored as text.

// https only; host is rzp.io exactly or a subdomain of razorpay.com; no port, no userinfo,
// no query or fragment; the path uses unreserved characters and slashes only. Matched as a
// whole string rather than through a URL parser, so there is nothing for a parser to
// reinterpret (rzp.io.evil.com, evil-rzp.io, www.rzp.io, user@rzp.io, rzp.io:443 all fail).
const PAYMENT_URL = /^https:\/\/(?:rzp\.io|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+razorpay\.com)\/[A-Za-z0-9._~\-\/]*[A-Za-z0-9._~\-][A-Za-z0-9._~\-\/]*$/;
const PAYMENT_URL_MAX = 500;

function isTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)+$|^UTC$/.test(tz);
  } catch {
    return false;
  }
}

function int(min, max, step = 1) {
  return (raw) => {
    const s = String(raw ?? "").trim();
    if (!/^\d+$/.test(s)) return { ok: false, error: "Whole number required." };
    const n = Number(s);
    if (n < min || n > max) return { ok: false, error: `Between ${min} and ${max}.` };
    if (n % step !== 0) return { ok: false, error: `Must be a multiple of ${step}.` };
    return { ok: true, value: String(n) };
  };
}

function paymentUrl(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return { ok: true, value: "" };
  if (s.length > PAYMENT_URL_MAX) return { ok: false, error: `At most ${PAYMENT_URL_MAX} characters.` };
  if (!PAYMENT_URL.test(s)) {
    return { ok: false, error: "Must be a Razorpay payment page URL: https://rzp.io/… or https://….razorpay.com/…" };
  }
  return { ok: true, value: s };
}

export const SETTINGS = [
  {
    key: "razorpay_mode",
    group: "Payment",
    label: "Active Razorpay payment page",
    help: "Which payment page the site links to. Switching to Live takes real money.",
    kind: "enum",
    options: ["test", "live"],
    default: "test",
    validate(raw) {
      const s = String(raw ?? "").trim();
      return s === "test" || s === "live" ? { ok: true, value: s } : { ok: false, error: "Test or Live." };
    },
  },
  {
    key: "razorpay_payment_url_test",
    group: "Payment",
    label: "Test-mode Razorpay payment page URL",
    help: "The Payment Page link from the Razorpay dashboard in Test mode.",
    kind: "url",
    placeholder: "https://rzp.io/rzp/XXXXXXX",
    default: "",
    validate: paymentUrl,
  },
  {
    key: "razorpay_payment_url_live",
    group: "Payment",
    label: "Live-mode Razorpay payment page URL",
    help: "The Payment Page link from the Razorpay dashboard in Live mode.",
    kind: "url",
    placeholder: "https://rzp.io/rzp/XXXXXXX",
    default: "",
    validate: paymentUrl,
  },
  {
    key: "scheduler_timezone",
    group: "Scheduler",
    label: "Scheduler timezone",
    help: "IANA name. Overrides are read in this zone.",
    kind: "text",
    placeholder: "Asia/Kolkata",
    default: "Asia/Kolkata",
    validate(raw) {
      const s = String(raw ?? "").trim();
      return isTimeZone(s) ? { ok: true, value: s } : { ok: false, error: "Not a known IANA timezone." };
    },
  },
  {
    key: "scheduler_slot_minutes",
    group: "Scheduler",
    label: "Session length (minutes)",
    help: "The offer is one hour. Multiples of 15.",
    kind: "number",
    default: "60",
    validate: int(15, 240, 15),
  },
  {
    key: "scheduler_buffer_minutes",
    group: "Scheduler",
    label: "Buffer after each session (minutes)",
    help: "Kept free after every booked slot.",
    kind: "number",
    default: "15",
    validate: int(0, 120, 5),
  },
  {
    key: "scheduler_min_notice_hours",
    group: "Scheduler",
    label: "Minimum notice (hours)",
    help: "No slot is offered sooner than this.",
    kind: "number",
    default: "24",
    validate: int(0, 336),
  },
  {
    key: "scheduler_window_days",
    group: "Scheduler",
    label: "Booking window (days)",
    help: "How far ahead slots are offered.",
    kind: "number",
    default: "30",
    validate: int(1, 90),
  },
];

export const SETTINGS_BY_KEY = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

export function validateSetting(key, raw) {
  const def = SETTINGS_BY_KEY[key];
  if (!def) return { ok: false, error: "Unknown setting." };
  return def.validate(raw);
}

/**
 * Validates a set of changes against the current values, per key and across keys.
 * Returns { ok, values, errors } where values holds the normalised changed values.
 */
export function validateChanges(current, changes) {
  const errors = {};
  const values = {};
  for (const [key, raw] of Object.entries(changes)) {
    const r = validateSetting(key, raw);
    if (r.ok) values[key] = r.value;
    else errors[key] = r.error;
  }
  const merged = { ...defaults(), ...current, ...values };
  const mode = merged.razorpay_mode;
  const activeKey = `razorpay_payment_url_${mode}`;
  if (!errors.razorpay_mode && !errors[activeKey] && !merged[activeKey]) {
    // Blame whichever field the person just touched.
    const field = activeKey in changes ? activeKey : "razorpay_mode";
    errors[field] = field === activeKey
      ? "This is the active payment page; it cannot be blank. Switch mode first."
      : `Set the ${mode === "live" ? "Live" : "Test"}-mode payment page URL before making it active.`;
  }
  return { ok: Object.keys(errors).length === 0, values, errors };
}

export function defaults() {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
}
