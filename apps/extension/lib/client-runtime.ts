import type { ClientRuntime } from "@threadflow-os/client-ui";
import type { SourceSnapshot } from "@threadflow-os/contracts";
import type { ComposerHandoffResult, ExtensionMessage } from "./messages.js";

export const extensionRuntime: ClientRuntime = {
  kind: "extension",
  async getPendingCapture() {
    const response = (await chrome.runtime
      .sendMessage({
        type: "GET_PENDING_CAPTURE",
      } satisfies ExtensionMessage)
      .catch(() => null)) as { source?: SourceSnapshot | null } | null;
    return response?.source ?? null;
  },
  async captureCurrent() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return null;
    const response = (await chrome.tabs
      .sendMessage(tab.id, {
        type: "CAPTURE_CURRENT_POST",
      } satisfies ExtensionMessage)
      .catch(() => null)) as { source?: SourceSnapshot } | null;
    return response?.source ?? null;
  },
  async hasGatewayPermission() {
    return chrome.permissions.contains({
      origins: ["http://127.0.0.1:8787/*"],
    });
  },
  async requestGatewayPermission() {
    return chrome.permissions.request({
      origins: ["http://127.0.0.1:8787/*"],
    });
  },
  async openExternal(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return false;
      await chrome.tabs.create({ url: parsed.toString() });
      return true;
    } catch {
      return false;
    }
  },
  async openComposer(text) {
    return chrome.runtime.sendMessage({
      type: "OPEN_COMPOSER",
      text,
    } satisfies ExtensionMessage) as Promise<ComposerHandoffResult>;
  },
};
