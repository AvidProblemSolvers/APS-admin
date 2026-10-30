// What each pane last loaded (with its default filters), kept in memory for this page only.
// A revisit paints from here at once. Any write clears everything — a write in one pane can
// change another (an approval adds a booking and an audit row) — and so does signing out.
// Loads that started before a clear are discarded when they land, so they cannot bring
// pre-write data back.

/** Within this age a revisit makes no request; older entries paint, then refresh. */
export const FRESH_MS = 30_000;

/** Actions that only read. Anything else is a write and clears the cache. */
export const READS = new Set(["list", "get", "summary", "detail", "status", "export_csv"]);

const entries = new Map(); // pane id → { data, at }
let gen = 0;

export const generation = () => gen;

export function cached(id) {
  const e = entries.get(id);
  return e && { data: structuredClone(e.data), at: e.at };
}

/** Stores a load that started at generation `since`, unless a write has landed since. */
export function remember(id, data, since) {
  if (since === gen) entries.set(id, { data: structuredClone(data), at: Date.now() });
}

export function forget() {
  entries.clear();
  gen++;
}
