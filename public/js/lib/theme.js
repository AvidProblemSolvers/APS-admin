// Light / dark theme. /js/theme-init.js applies the stored choice before first paint; this
// module reads and changes it. Storage may throw (private window, blocked site data): the
// choice then lasts for this page only.

export const THEME_KEY = "aps-admin-theme";

export function currentTheme() {
  return globalThis.document?.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function setTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch { /* storage blocked */ }
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  for (const b of document.querySelectorAll("[data-theme-set]")) b.setAttribute("aria-pressed", String(b.dataset.themeSet === t));
}
