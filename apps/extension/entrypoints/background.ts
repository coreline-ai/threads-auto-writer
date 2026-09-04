import type {
  ComposerFillResult,
  ComposerHandoffResult,
  ExtensionMessage,
} from "../lib/messages.js";
import type { SourceSnapshot } from "@threadflow-os/contracts";
import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => undefined);
    chrome.contextMenus.create({
      id: "threadflow-capture-post",
      title: "ThreadFlow OS로 이 게시물 가져오기",
      contexts: ["page", "selection"],
      documentUrlPatterns: [
        "https://www.threads.com/*",
        "https://threads.com/*",
      ],
    });
    chrome.contextMenus.create({
      id: "threadflow-capture-selection",
      title: "ThreadFlow OS로 선택 문장 가져오기",
      contexts: ["selection"],
      documentUrlPatterns: [
        "https://www.threads.com/*",
        "https://threads.com/*",
      ],
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    let source: SourceSnapshot | null = null;
    if (
      info.menuItemId === "threadflow-capture-selection" &&
      info.selectionText?.trim()
    ) {
      source = {
        id: crypto.randomUUID(),
        text: info.selectionText.trim(),
        author: null,
        url: tab.url ?? null,
        capturedAt: new Date().toISOString(),
        captureMethod: "selection",
        adapterVersion: "threads-web-v1",
      };
    } else {
      const response = (await chrome.tabs
        .sendMessage(tab.id, {
          type: "CAPTURE_CURRENT_POST",
        } satisfies ExtensionMessage)
        .catch(() => null)) as { source?: SourceSnapshot } | null;
      source = response?.source ?? null;
    }
    if (source) await chrome.storage.local.set({ pendingCapture: source });
    await chrome.sidePanel.open({ tabId: tab.id });
  });

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (message.type === "GET_PENDING_CAPTURE") {
        chrome.storage.local
          .get("pendingCapture")
          .then(async ({ pendingCapture }) => {
            await chrome.storage.local.remove("pendingCapture");
            sendResponse({ source: pendingCapture ?? null });
          });
        return true;
      }
      if (message.type === "OPEN_COMPOSER") {
        void openComposer(message.text).then(sendResponse);
        return true;
      }
      return false;
    },
  );
});

async function openComposer(text: string): Promise<ComposerHandoffResult> {
  const tab = await chrome.tabs.create({ url: "https://www.threads.com/" });
  if (!tab.id)
    return {
      ok: false,
      status: "composer-not-found",
      method: "none",
      fallback: "clipboard",
    };
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: ComposerFillResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({
        ok: result.ok,
        status: result.status,
        method: result.method,
        fallback: "clipboard",
      });
    };
    const tryFill = async () => {
      try {
        const result = (await chrome.tabs.sendMessage(tab.id!, {
          type: "FILL_COMPOSER",
          text,
        } satisfies ExtensionMessage)) as ComposerFillResult;
        finish(result);
      } catch {
        if (!finished) setTimeout(() => void tryFill(), 300);
      }
    };
    const listener = (tabId: number, info: { status?: string }) => {
      if (tabId === tab.id && info.status === "complete") void tryFill();
    };
    const timeout = setTimeout(
      () =>
        finish({
          type: "COMPOSER_RESULT",
          ok: false,
          status: "composer-not-found",
          method: "none",
        }),
      15_000,
    );
    chrome.tabs.onUpdated.addListener(listener);
    if (tab.status === "complete") void tryFill();
  });
}
