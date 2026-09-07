// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { RevisionPanel } from "../../../packages/client-ui/src/RevisionPanel.js";
let root: Root, host: HTMLDivElement;
const apply = vi.fn(),
  busy = vi.fn();
let request = vi.fn();
let text = "사람이 다듬은 본문";
async function render() {
  await act(async () =>
    root.render(
      createElement(RevisionPanel, {
        contextKey: "work-a",
        text,
        request,
        onApply: apply,
        onBusy: busy,
      }),
    ),
  );
}
async function submit() {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(".revision-presets button")!.click();
  });
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  apply.mockReset();
  busy.mockReset();
  text = "사람이 다듬은 본문";
  request = vi
    .fn()
    .mockResolvedValue({ text: "미리 본 수정안", riskFlags: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
describe("revision preview", () => {
  it("previews current text without applying and supports discard", async () => {
    await render();
    await submit();
    expect(request.mock.calls[0]?.[2]).toBe(text);
    expect(apply).not.toHaveBeenCalled();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".revision-preview .secondary")!
        .click();
    });
    expect(host.querySelector(".revision-preview")).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
  it("applies once only after an explicit action", async () => {
    await render();
    await submit();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".revision-preview .primary")!
        .click();
    });
    expect(apply).toHaveBeenCalledExactlyOnceWith("미리 본 수정안");
  });
  it("rejects stale results when editing during a request and suppresses duplicate requests", async () => {
    let finish!: (value: unknown) => void;
    request = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await submit();
    await submit();
    expect(request).toHaveBeenCalledOnce();
    text = "응답 전에 다시 수정";
    await render();
    await act(async () => finish({ text: "늦은 결과", riskFlags: [] }));
    expect(
      host.querySelector<HTMLButtonElement>(".revision-preview .primary")
        ?.disabled,
    ).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });
  it("keeps the parent request lock while the panel is hidden, then releases it", async () => {
    let finish!: (value: unknown) => void;
    request = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await submit();
    await act(async () => root.render(null));
    expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => finish({ text: "숨겨진 응답", riskFlags: [] }));
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it("preserves feedback and text on timeout/error", async () => {
    request.mockRejectedValue(new Error("timed out"));
    await render();
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "timed out",
    );
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).not.toBe(
      "",
    );
    expect(apply).not.toHaveBeenCalled();
    expect(busy).toHaveBeenLastCalledWith(false);
  });
});
