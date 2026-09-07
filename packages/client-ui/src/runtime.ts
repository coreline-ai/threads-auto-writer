import type { SourceSnapshot } from "@threadflow-os/contracts";

export type ClientRuntimeKind = "web" | "extension";

export type ComposerHandoffResult = {
  ok: boolean;
  status: "filled" | "login-required" | "composer-not-found" | "opened";
  method: "contenteditable" | "textarea" | "none";
  fallback: "clipboard";
};

export interface ClientRuntime {
  kind: ClientRuntimeKind;
  getPendingCapture(): Promise<SourceSnapshot | null>;
  captureCurrent(): Promise<SourceSnapshot | null>;
  hasGatewayPermission(): Promise<boolean>;
  requestGatewayPermission(): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  openComposer(text: string): Promise<ComposerHandoffResult>;
}

function openWebTab(url: string): boolean {
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}

export const webRuntime: ClientRuntime = {
  kind: "web",
  async getPendingCapture() {
    return null;
  },
  async captureCurrent() {
    return null;
  },
  async hasGatewayPermission() {
    return true;
  },
  async requestGatewayPermission() {
    return true;
  },
  async openExternal(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && openWebTab(parsed.toString());
    } catch {
      return false;
    }
  },
  async openComposer() {
    const opened = openWebTab("https://www.threads.com/");
    return {
      ok: opened,
      status: opened ? "opened" : "composer-not-found",
      method: "none",
      fallback: "clipboard",
    };
  },
};
