import {
  extractCurrentThreadPost,
  fillComposer,
  getComposerAvailability,
  openComposerSurface,
} from "@threadflow-os/threads-adapter";
import type { ComposerFillResult, ExtensionMessage } from "../lib/messages.js";
import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["https://www.threads.com/*", "https://threads.com/*"],
  main() {
    let lastTarget: Element | null = null;
    document.addEventListener("contextmenu", (event) => {
      lastTarget = event.target instanceof Element ? event.target : null;
    });
    chrome.runtime.onMessage.addListener(
      (message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === "CAPTURE_CURRENT_POST") {
          const extracted = extractCurrentThreadPost(document, {
            pageUrl: location.href,
            preferredTarget: lastTarget,
          });
          sendResponse({
            source: extracted
              ? { ...extracted, id: crypto.randomUUID() }
              : null,
          });
          return false;
        }
        if (message.type === "FILL_COMPOSER") {
          void fillComposerWhenReady(message.text).then(sendResponse);
          return true;
        }
        return false;
      },
    );
  },
});

async function fillComposerWhenReady(
  text: string,
): Promise<ComposerFillResult> {
  const deadline = Date.now() + 8_000;
  let openedComposer = false;
  while (Date.now() < deadline) {
    const availability = getComposerAvailability(document, location.href);
    if (availability === "login-required") {
      return {
        type: "COMPOSER_RESULT",
        ok: false,
        status: "login-required",
        method: "none",
      };
    }
    const result = fillComposer(document, text);
    if (result.ok) {
      return { type: "COMPOSER_RESULT", status: "filled", ...result };
    }
    if (!openedComposer) {
      openedComposer = openComposerSurface(document);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    type: "COMPOSER_RESULT",
    ok: false,
    status: "composer-not-found",
    method: "none",
  };
}
