// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  appearance,
  APPEARANCE_KEY,
  normalizeAppearance,
  resolveAppearance,
} from "../../../packages/client-ui/src/appearance.js";
let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
describe("appearance", () => {
  it("validates values and resolves explicit preference before the OS", () => {
    expect(normalizeAppearance("corrupted")).toBe("system");
    expect(resolveAppearance("dark", false)).toBe("dark");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("system", true)).toBe("dark");
  });
  it("reacts to OS changes only in system mode", () => {
    let changed = () => {};
    const media = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => {
        changed = fn;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => media);
    cleanup = appearance.subscribe(() => {});
    appearance.set("system");
    media.matches = true;
    changed();
    expect(document.documentElement.dataset.theme).toBe("dark");
    appearance.set("light");
    changed();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("persists and syncs same-origin changes, and resets", () => {
    cleanup = appearance.subscribe(() => {});
    appearance.set("dark");
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe("dark");
    localStorage.setItem(APPEARANCE_KEY, "light");
    window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_KEY }));
    expect(appearance.getSnapshot().mode).toBe("light");
    expect(appearance.reset()).toBe(true);
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull();
    expect(appearance.getSnapshot().mode).toBe("system");
  });
  it("applies locally but reports storage failure", () => {
    cleanup = appearance.subscribe(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    appearance.set("dark");
    expect(appearance.getSnapshot()).toEqual({ mode: "dark", saved: false });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("keeps early bootstrap consistent with the runtime, including blocked storage", () => {
    const code = readFileSync(
      "packages/client-ui/public/appearance-init.js",
      "utf8",
    );
    for (const saved of ["light", "dark", "system", "broken", null])
      for (const dark of [true, false]) {
        const root = { dataset: {}, style: {} };
        runInNewContext(code, {
          localStorage: { getItem: () => saved },
          matchMedia: () => ({ matches: dark }),
          document: { documentElement: root },
        });
        expect(root.dataset).toEqual({
          theme: resolveAppearance(normalizeAppearance(saved), dark),
        });
      }
    const root = { dataset: {}, style: {} };
    runInNewContext(code, {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      matchMedia: () => ({ matches: true }),
      document: { documentElement: root },
    });
    expect(root.dataset).toEqual({ theme: "dark" });
  });
  it("declares a blocking external initializer before the app module in both entrypoints", () => {
    for (const path of [
      "apps/web/index.html",
      "apps/extension/entrypoints/sidepanel/index.html",
    ]) {
      const html = readFileSync(path, "utf8");
      expect(html.indexOf("appearance-init.js")).toBeLessThan(
        html.indexOf('type="module"'),
      );
      expect(html).not.toMatch(
        /<script[^>]*(?:async|defer)[^>]*appearance-init/,
      );
    }
  });
});
