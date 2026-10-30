// Applies the stored theme before first paint. A classic, render-blocking script in <head>:
// not a module (modules are deferred) and not inline (the CSP forbids inline scripts).
// No stored choice, or storage that throws, means dark. lib/theme.js changes it later.
(function () {
  var theme = "dark";
  try {
    if (localStorage.getItem("aps-admin-theme") === "light") theme = "light";
  } catch (e) { /* storage blocked: dark */ }
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  try {
    var bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (bg && meta) meta.setAttribute("content", bg);
  } catch (e) { /* stylesheet not loaded: keep the default */ }
})();
