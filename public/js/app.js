// Controller: auth state → screen. Routing is by hash (#/bookings).

import { api, download, onAuthLost } from "./lib/api.js";
import { consumeRedirect, hasSession, NEUTRAL_SENT, sendLink, signOut, verifyCode } from "./lib/auth.js";
import { canSee, PANES } from "./lib/panes.js";
import { mountPane } from "./lib/pane.js";
import { frame, notAuthorised, signIn } from "./views/shell.js";
import answers from "./views/answers.js";
import audit from "./views/audit.js";
import availability from "./views/availability.js";
import bookings from "./views/bookings.js";
import content from "./views/content.js";
import settings from "./views/settings.js";
import signals from "./views/signals.js";
import slotRequests from "./views/slot-requests.js";
import team from "./views/team.js";
import traffic from "./views/traffic.js";

const VIEWS = Object.fromEntries([bookings, slotRequests, availability, content, answers, signals, traffic, team, audit, settings].map((v) => [v.id, v]));
const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
let me = null;
let toastTimer;

function toast(msg, bad = false) {
  toastEl.textContent = msg;
  toastEl.className = `toast show${bad ? " bad" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), bad ? 7000 : 3500);
}

function showSignIn(state) {
  me = null;
  app.innerHTML = String(signIn(state));
  app.querySelector(state?.codeFor ? "input[name=code]" : "input[type=email]")?.focus();
}

function showNotAuthorised() {
  me = null;
  app.innerHTML = String(notAuthorised());
}

function route() {
  if (!me) return;
  const wanted = location.hash.replace(/^#\/?/, "") || "bookings";
  // A pane this role may not see is never mounted, even if typed into the address bar.
  const id = canSee(me.role, wanted) && VIEWS[wanted] ? wanted : "bookings";
  if (id !== wanted) history.replaceState(null, "", `#/${id}`);
  app.innerHTML = String(frame(me, id));
  document.title = `${PANES.find((p) => p.id === id).title} · APS Admin`;
  const root = document.getElementById("pane");
  mountPane(root, {
    me,
    role: me.role,
    api,
    download: (fn, body) => download(fn, body).catch((e) => toast(e.message, true)),
    toast,
    confirm: (m) => window.confirm(m),
  }, VIEWS[id]);
}

async function start() {
  const linkError = consumeRedirect();
  if (!hasSession()) return showSignIn({ error: linkError });
  try {
    me = await api("admin-me", { action: "me" });
  } catch (e) {
    if (e.code === "signed_out" || e.status === 401) return showSignIn({});
    if (e.status === 403) return showNotAuthorised();
    app.innerHTML = `<main class="gate"><p class="message">Could not reach the admin service. Reload to try again.</p></main>`;
    return;
  }
  route();
}

onAuthLost((why) => (why === "not_authorised" ? showNotAuthorised() : showSignIn({ message: "Your session ended. Sign in again." })));

app.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form=send-link], [data-form=verify-code]");
  if (!form) return;
  e.preventDefault();
  const email = form.elements.email.value.trim();
  const status = app.querySelector(".message");
  const btn = form.querySelector("button");
  if (form.dataset.form === "verify-code") {
    btn.disabled = true;
    const error = await verifyCode(email, form.elements.code.value);
    if (!error) return start();
    status.textContent = error;
    btn.disabled = false;
    form.elements.code.select();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = "Enter an email address.";
    return;
  }
  btn.disabled = true;
  const reply = await sendLink(email);
  // The code field appears for every on-domain address, known or not, so it reveals nothing.
  if (reply === NEUTRAL_SENT) showSignIn({ message: reply, codeFor: email.toLowerCase() });
  else status.textContent = reply;
  const again = app.querySelector("[data-form=send-link] button");
  again.disabled = true;
  setTimeout(() => (again.disabled = false), 30_000);
});

app.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-signout]")) return;
  await signOut();
  showSignIn({ message: "Signed out." });
});

// A sign-in link opened in a tab that already shows the admin only changes the hash.
window.addEventListener("hashchange", () => (/(^#|&)(access_token|error)=/.test(location.hash) ? start() : route()));
start();
