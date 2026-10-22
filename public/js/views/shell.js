// Sign-in, Not authorised, and the signed-in frame. Pure renders.

import { html } from "../lib/html.js";
import { panesFor } from "../lib/panes.js";

const logo = html`<img class="gate-logo" src="/APS_LOGO.png" alt="Avid Problem Solvers" width="160" height="100">`;

export function signIn({ message = "", error = "" } = {}) {
  return html`<main class="gate">
    ${logo}
    <p class="eyebrow">APS Admin</p>
    <form data-form="send-link" novalidate>
      <label class="field"><span class="label sr-only">Email</span>
        <input type="email" name="email" required autocomplete="email" placeholder="you@avidproblemsolvers.com" aria-label="Email"></label>
      <button class="btn primary" type="submit">Email me a sign-in link</button>
    </form>
    <p class="message" role="status">${error ? html`<span class="bad-text">${error}</span>` : message}</p>
  </main>`;
}

/** One screen for every refusal. It never says whether the address exists. */
export function notAuthorised() {
  return html`<main class="gate">
    ${logo}
    <h1>Not authorised</h1>
    <p class="message">This account does not have access to APS Admin.</p>
    <button class="btn" type="button" data-signout>Sign out</button>
  </main>`;
}

/** Only the tabs this role may use are rendered — the others do not exist in the DOM. */
export function frame(me, active) {
  return html`
    <header class="top">
      <img src="/APS_LOGO.png" alt="Avid Problem Solvers" width="45" height="28">
      <span class="eyebrow muted">Admin</span>
      <div class="who">
        <span class="email">${me.email}</span>
        <span class="pill ${me.role === "owner" ? "ok" : ""}">${me.role}</span>
        <button class="btn small" type="button" data-signout>Sign out</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Sections">
      ${panesFor(me.role).map((p) => html`<a href="#/${p.id}"${p.id === active ? html` aria-current="page"` : ""}>${p.title}</a>`)}
    </nav>
    <main id="pane" class="pane" tabindex="-1"></main>`;
}
