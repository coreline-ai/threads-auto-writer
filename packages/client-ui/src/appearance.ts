export type AppearanceMode = "system" | "light" | "dark";
export const APPEARANCE_KEY = "threadflow.appearance";
export function normalizeAppearance(value: unknown): AppearanceMode {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolveAppearance(
  mode: AppearanceMode,
  dark: boolean,
): "light" | "dark" {
  return mode === "system" ? (dark ? "dark" : "light") : mode;
}
function readMode(): AppearanceMode {
  try {
    return normalizeAppearance(localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return "system";
  }
}
let snapshot = { mode: readMode(), saved: true };
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
function apply() {
  if (typeof document === "undefined") return;
  const theme = resolveAppearance(
    snapshot.mode,
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
function emit() {
  apply();
  listeners.forEach((listener) => listener());
}
export const appearance = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (!stop && typeof window !== "undefined") {
      snapshot = { mode: readMode(), saved: true };
      const media = window.matchMedia?.("(prefers-color-scheme: dark)");
      const changed = () => apply();
      const stored = (event: StorageEvent) => {
        if (event.key !== null && event.key !== APPEARANCE_KEY) return;
        snapshot = { mode: readMode(), saved: true };
        emit();
      };
      media?.addEventListener("change", changed);
      window.addEventListener("storage", stored);
      stop = () => {
        media?.removeEventListener("change", changed);
        window.removeEventListener("storage", stored);
      };
      apply();
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        stop?.();
        stop = undefined;
      }
    };
  },
  set(value: AppearanceMode) {
    const mode = normalizeAppearance(value);
    let saved = true;
    try {
      localStorage.setItem(APPEARANCE_KEY, mode);
    } catch {
      saved = false;
    }
    snapshot = { mode, saved };
    emit();
  },
  reset() {
    let saved = true;
    try {
      localStorage.removeItem(APPEARANCE_KEY);
    } catch {
      saved = false;
    }
    snapshot = { mode: "system", saved };
    emit();
    return saved;
  },
};
