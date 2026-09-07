/* global localStorage, matchMedia, document */
/* Runs synchronously before styles/React. Keep parity with appearance.ts tests. */
(() => {
  let mode = "system";
  try {
    const saved = localStorage.getItem("threadflow.appearance");
    if (saved === "light" || saved === "dark") mode = saved;
  } catch {
    /* Storage may be disabled; system preference still works. */
  }
  const theme =
    mode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
