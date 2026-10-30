// Sign-in, Not authorised, and the signed-in frame. Pure renders.

import { ALLOWED_EMAIL_DOMAIN } from "../config.js";
import { html } from "../lib/html.js";
import { panesFor } from "../lib/panes.js";
import { allowedDomain } from "../shared/email_domain.js";
import { currentTheme } from "../lib/theme.js";

/** Two text-labelled buttons; aria-pressed marks the theme in use. app.js handles the click. */
export function themeToggle() {
  const t = currentTheme();
  return html`<div class="seg theme-toggle" role="group" aria-label="Theme">
    <button type="button" data-theme-set="dark" aria-pressed="${String(t === "dark")}">Dark</button>
    <button type="button" data-theme-set="light" aria-pressed="${String(t === "light")}">Light</button>
  </div>`;
}

const logo = html`<img class="gate-logo" src="/APS_LOGO.png" alt="Avid Problem Solvers" width="160" height="100">`;

/** `codeFor` is the address a code was just requested for; it adds the code field. */
export function signIn({ message = "", error = "", codeFor = "" } = {}) {
  return html`<main class="gate">
    ${themeToggle()}
    ${logo}
    <p class="eyebrow">APS Admin</p>
    <form data-form="send-link" novalidate>
      <label class="field"><span class="label sr-only">Email</span>
        <input type="email" name="email" required autocomplete="email" placeholder="you${allowedDomain(ALLOWED_EMAIL_DOMAIN)}" aria-label="Email" value="${codeFor}"></label>
      <button class="btn${codeFor ? "" : " primary"}" type="submit">Email me a sign-in code</button>
    </form>
    ${codeFor ? html`<form data-form="verify-code" novalidate>
      <input type="hidden" name="email" value="${codeFor}">
      <label class="field"><span class="label sr-only">Sign-in code</span>
        <input type="text" class="code" name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="six-digit code" aria-label="Sign-in code"></label>
      <button class="btn primary" type="submit">Sign in</button>
    </form>` : ""}
    <p class="message" role="status">${error ? html`<span class="bad-text">${error}</span>` : message}</p>
  </main>`;
}

/** One screen for every refusal. It never says whether the address exists. */
export function notAuthorised() {
  return html`<main class="gate">
    ${themeToggle()}
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
        ${themeToggle()}
        <button class="btn small" type="button" data-signout>Sign out</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Sections">
      ${panesFor(me.role).map((p) => html`<a href="#/${p.id}"${p.id === active ? html` aria-current="page"` : ""}>${p.title}</a>`)}
    </nav>
    <main id="pane" class="pane" tabindex="-1"></main>`;
}
