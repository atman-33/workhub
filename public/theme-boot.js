// Paints the stored color theme before first paint, so a light-theme start
// never flashes dark. Classic script on purpose (modules load too late).
// Keep the key and rule in sync with src/lib/theme.ts.
(function () {
  var pref = "dark";
  try {
    var raw = localStorage.getItem("app.theme");
    if (raw === "light" || raw === "dark" || raw === "system") pref = raw;
  } catch (e) {}
  var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
