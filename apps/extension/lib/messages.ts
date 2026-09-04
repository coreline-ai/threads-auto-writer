import type { SourceSnapshot } from "@threadflow-os/contracts";

export type ComposerFillResult = {
  type: "COMPOSER_RESULT";
  ok: boolean;
  status: "filled" | "login-required" | "composer-not-found";
  method: "contenteditable" | "textarea" | "none";
};

export type ComposerHandoffResult = Omit<ComposerFillResult, "type"> & {
  fallback: "clipboard";
};

export type ExtensionMessage =
  | { type: "CAPTURE_CURRENT_POST" }
  | { type: "CAPTURE_RESULT"; source: SourceSnapshot }
  | { type: "GET_PENDING_CAPTURE" }
  | { type: "OPEN_COMPOSER"; text: string }
  | { type: "FILL_COMPOSER"; text: string }
  | ComposerFillResult;
