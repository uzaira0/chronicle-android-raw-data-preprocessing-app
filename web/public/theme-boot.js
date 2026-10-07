// Sets the theme on <html> before the boot skeleton paints. The app's own
// applyTheme (src/lib/theme.ts) runs only once its JavaScript has loaded, so
// without this a dark-mode user sees a light page first. The CSP allows no
// inline script, so this is a classic same-origin script loaded from <head>.
// theme.test.ts runs this file against applyTheme for every saved/system
// combination, so the two cannot drift.
(function () {
  var theme = "system";
  try {
    var saved = localStorage.getItem("chronicle.theme.v1");
    if (saved === "light" || saved === "dark" || saved === "system") theme = saved;
  } catch (error) {
    // Storage can be unavailable (private browsing); the system theme applies.
  }
  if (theme === "system") {
    theme =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
