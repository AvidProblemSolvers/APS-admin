// Minimal pane controller: load → render → delegated events → repaint regions.
// Views stay pure (state, ctx) → html so they can be tested without a browser.

import { cached, FRESH_MS, generation, remember } from "./cache.js";
import { html } from "./html.js";

const EVENTS = ["click", "change", "input", "submit"];

export function mountPane(root, ctx, view) {
  let state = null;
  let touched = false; // the user has used this pane since it mounted
  const self = {
    root,
    get state() {
      return state;
    },
    /** Merge into state and re-render the whole pane. */
    set(next) {
      state = { ...state, ...next };
      draw();
    },
    /** Merge into state and re-render one data-region only (keeps focus elsewhere). */
    patch(next, ...regions) {
      state = { ...state, ...next };
      for (const name of regions) {
        const el = root.querySelector(`[data-region="${name}"]`);
        if (el && view.regions?.[name]) el.innerHTML = String(view.regions[name](state, ctx));
      }
    },
    /** The part of the hash after the pane id changed (e.g. #/content/<section>). */
    route(sub) {
      ctx.sub = sub;
      view.route?.(sub, self, ctx);
    },
    async reload(keep = {}) {
      try {
        const loaded = await view.load(ctx, state);
        state = { ...(state ?? {}), ...loaded, ...keep };
        draw();
      } catch (e) {
        root.innerHTML = String(html`<p class="empty">${e.message || "Could not load this pane."}</p>`);
      }
    },
  };

  function draw() {
    root.innerHTML = String(view.render(state, ctx));
  }

  for (const type of EVENTS) {
    root.addEventListener(type, async (e) => {
      const el = e.target.closest?.(`[data-${type}]`);
      if (!el || !root.contains(el)) return;
      const handler = view.on?.[`${type}:${el.dataset[type]}`];
      if (!handler) return;
      touched = true;
      if (type === "submit" || (type === "click" && el.tagName === "A")) e.preventDefault();
      const busy = type === "click" || type === "submit" ? (el.tagName === "FORM" ? el.querySelector("[type=submit]") : el) : null;
      if (busy) busy.disabled = true;
      try {
        await handler(el, self, ctx, e);
      } catch (err) {
        ctx.toast(err.message || "Something went wrong.", true);
      } finally {
        if (busy && busy.isConnected) busy.disabled = false;
      }
    });
  }

  /** Loads with the default filters and remembers it. A background refresh repaints only if
   * the data changed and the user has not started using the pane. */
  async function refresh(shown) {
    const since = generation();
    try {
      const loaded = await view.load(ctx, defaults);
      remember(view.id, loaded, since);
      if (shown && (touched || !root.isConnected || root.contains(document.activeElement) || JSON.stringify(loaded) === JSON.stringify(shown))) return;
      state = { ...state, ...loaded };
      draw();
    } catch (e) {
      if (!shown) root.innerHTML = String(html`<p class="empty">${e.message || "Could not load this pane."}</p>`);
    }
  }

  state = view.initial?.(ctx) ?? {};
  const defaults = state;
  const hit = cached(view.id);
  if (hit) {
    state = { ...state, ...hit.data };
    draw();
    if (Date.now() - hit.at > FRESH_MS) refresh(hit.data);
  } else {
    root.innerHTML = String(html`<p class="loading">Loading…</p>`);
    refresh(null);
  }
  return self;
}

/** Reads a form into a plain object (checkboxes → booleans). */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return out;
}
