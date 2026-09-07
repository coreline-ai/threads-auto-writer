// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EditorActions } from "../../../packages/client-ui/src/EditorActions.js";
it("gates 0/500/501, blocking, approved and busy states in one action bar", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const onApprove = vi.fn(),
    onHandoff = vi.fn();
  for (const [count, approved, blocking, busy, canApprove, canHandoff] of [
    [0, false, false, false, false, false],
    [500, false, false, false, true, false],
    [501, true, false, false, false, false],
    [500, true, false, false, false, true],
    [200, true, true, false, false, false],
    [200, true, false, true, false, false],
  ] as const) {
    await act(async () =>
      root.render(
        createElement(EditorActions, {
          text: "가".repeat(count),
          approved,
          blocking,
          busy,
          warningCount: 0,
          extension: false,
          onApprove,
          onHandoff,
        }),
      ),
    );
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(!canApprove);
    expect(buttons[1].disabled).toBe(!canHandoff);
    expect(host.textContent).toContain(`${count}/500자`);
  }
  await act(async () => root.unmount());
});
