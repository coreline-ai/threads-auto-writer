// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../packages/client-ui/src/App.js";
import { webRuntime } from "../../../packages/client-ui/src/runtime.js";
import { useWorkflowStore } from "../../../packages/client-ui/src/workflow-store.js";
import type { FinalDraft } from "@threadflow-os/contracts";

const storage = vi.hoisted(() => {
  const get = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn().mockResolvedValue("current");
  const workspaceGet = vi.fn().mockResolvedValue(undefined);
  const rows = { toArray: vi.fn().mockResolvedValue([]) };
  return {
    get,
    put,
    workspaceGet,
    rows,
    saveApproved: vi.fn().mockResolvedValue({ version: 1 }),
    edits: vi.fn().mockResolvedValue("edit"),
  };
});
vi.mock("../../../packages/client-ui/src/database.js", () => ({
  db: {
    personas: { get: storage.get },
    settings: { get: storage.get },
    loadActiveWorkspace: storage.workspaceGet,
    saveWorkingDraft: async (
      id: string,
      snapshot: unknown,
      revision: number,
    ) => {
      await storage.put(snapshot);
      return { id, snapshot, revision: revision + 1 };
    },
    workingDrafts: storage.rows,
    drafts: {
      orderBy: () => ({ reverse: () => storage.rows }),
      where: () => ({ equals: () => storage.rows }),
    },
    saveDraftVersion: storage.saveApproved,
    edits: { add: storage.edits },
    calendarSlots: { orderBy: () => storage.rows },
    publicationLinks: storage.rows,
  },
}));

let root: Root;
let host: HTMLDivElement;
let queryClient: QueryClient;
const draft: FinalDraft = {
  id: "draft-layout",
  generationId: "generation-layout",
  selectedCandidateId: "candidate-layout",
  text: "자동 검사 이후에도 사실과 문맥을 직접 확인합니다.",
  score: {
    hook: 80,
    originality: 80,
    readability: 80,
    personaFit: 80,
    evidence: 80,
    cta: 80,
    policy: 80,
    total: 80,
  },
  riskFlags: [],
  approvalStatus: "DRAFT",
  promptVersion: "2.0.0",
  rubricVersion: "1.0.0",
  createdAt: "2026-09-06T00:00:00.000Z",
  approvedAt: null,
};
async function render(kind: "web" | "extension" = "web") {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(App, { runtime: { ...webRuntime, kind } }),
      ),
    );
  });
}
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  expect(found, `button ${label}`).toBeDefined();
  return found!;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  storage.get.mockReset().mockResolvedValue(undefined);
  storage.workspaceGet.mockReset().mockResolvedValue(undefined);
  storage.put.mockReset().mockResolvedValue("current");
  storage.saveApproved.mockReset().mockResolvedValue({ version: 1 });
  useWorkflowStore.getState().clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  host.remove();
  vi.useRealTimers();
});

describe("editorial studio UI", () => {
  it("renders an empty editor beside the brief without inventing a draft", async () => {
    await render();
    expect(
      host.querySelector(".shell-web .writer-layout .one-turn-card"),
    ).not.toBeNull();
    expect(host.querySelector(".result-column .editor-empty")).not.toBeNull();
    expect(
      host.querySelector('[aria-label="주제·메모·참고 글"]'),
    ).not.toBeNull();
    expect(host.querySelector(".editor")).toBeNull();
    expect(button("1턴으로 완성하기").disabled).toBe(true);
    await act(async () => button("다듬기").click());
    expect(button("다듬기").getAttribute("aria-pressed")).toBe("true");
    expect(button("새 글").getAttribute("aria-pressed")).toBe("false");
  });
  it("reports storage success only after the debounced database write", async () => {
    await render();
    expect(host.querySelector(".save-status")?.textContent).toBe(
      "자동 보관 중…",
    );
    expect(storage.put).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(storage.put).toHaveBeenCalledOnce();
    expect(host.querySelector(".save-status")?.textContent).toBe(
      "이 브라우저에 자동 보관됨",
    );
  });
  it("shows a storage error and recovers on a subsequent successful change", async () => {
    storage.put.mockRejectedValueOnce(new Error("quota"));
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(host.querySelector(".save-status.error")).not.toBeNull();
    await act(async () => button("다듬기").click());
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(host.querySelector(".save-status.saved")).not.toBeNull();
  });
  it("does not let a stale save mark newer changes as saved", async () => {
    let finish!: (value: string) => void;
    storage.put.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await act(async () => button("다듬기").click());
    await act(async () => finish("current"));
    expect(host.querySelector(".save-status.saving")).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(host.querySelector(".save-status.saved")).not.toBeNull();
  });
  it("does not overwrite stored work when hydration fails", async () => {
    storage.workspaceGet.mockRejectedValueOnce(new Error("읽기 실패"));
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(storage.put).not.toHaveBeenCalled();
    expect(host.querySelector(".save-status.error")).not.toBeNull();
    expect(button("1턴으로 완성하기").disabled).toBe(true);
    expect(host.querySelector('[aria-label="알림 닫기"]')).not.toBeNull();
  });
  it("flushes the pending edit before opening a clean new workspace", async () => {
    await render();
    await act(async () => useWorkflowStore.getState().edit("보존할 본문"));
    await act(async () => button("+ 새 작업").click());
    expect(storage.put.mock.calls[0][0].workflow.editorText).toBe(
      "보존할 본문",
    );
    expect(storage.put.mock.calls[1][0].workflow.editorText).toBe("");
    expect(useWorkflowStore.getState().editorText).toBe("");
  });
  it("does not switch or clear the editor when flush fails", async () => {
    await render();
    await act(async () =>
      useWorkflowStore.getState().edit("저장 실패해도 보존"),
    );
    storage.put.mockRejectedValueOnce(new Error("quota"));
    await act(async () => button("+ 새 작업").click());
    expect(useWorkflowStore.getState().editorText).toBe("저장 실패해도 보존");
    expect(host.querySelector(".save-status.error")).not.toBeNull();
    expect(storage.put).toHaveBeenCalledOnce();
  });
  it("locks workspace transitions before asynchronous flushing returns", async () => {
    await render();
    await act(async () => useWorkflowStore.getState().edit("원본"));
    let finish!: (value: string) => void;
    storage.put.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      button("+ 새 작업").click();
      button("+ 새 작업").click();
    });
    expect(button("+ 새 작업").disabled).toBe(true);
    expect(
      (host.querySelector("fieldset.writer-layout") as HTMLFieldSetElement)
        .disabled,
    ).toBe(true);
    expect(storage.put).toHaveBeenCalledOnce();
    await act(async () => finish("saved"));
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(useWorkflowStore.getState().editorText).toBe("");
  });
  it("shows actual active, canceled and failed stages without estimated percentages", async () => {
    await render();
    await act(async () =>
      useWorkflowStore.getState().begin("generation-layout"),
    );
    expect(host.querySelector(".progress")?.textContent).toContain("준비");
    expect(host.querySelector(".progress")?.textContent).not.toContain("%");
    expect(button("생성 취소")).toBeDefined();
    expect(button("초안 작성 중…").disabled).toBe(true);
    await act(async () => useWorkflowStore.getState().cancelLocal());
    expect(host.querySelector(".progress")?.textContent).toContain("취소");
    await act(async () =>
      useWorkflowStore.getState().fail("연결을 확인하세요"),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "연결을 확인하세요",
    );
  });
  it("does not overwrite newer edits or duplicate a pending approval save", async () => {
    await render();
    await act(async () => useWorkflowStore.getState().loadDraft(draft, []));
    let finish!: (value: unknown) => void;
    storage.saveApproved.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      button("최종 승인 저장").click();
      button("최종 승인 저장").click();
    });
    expect(storage.saveApproved).toHaveBeenCalledOnce();
    await act(async () =>
      useWorkflowStore.getState().edit("저장 요청 이후의 편집"),
    );
    await act(async () => finish({ version: 1 }));
    expect(useWorkflowStore.getState().editorText).toBe(
      "저장 요청 이후의 편집",
    );
    expect(useWorkflowStore.getState().finalDraft?.approvalStatus).toBe(
      "DRAFT",
    );
    expect(button("복사하고 Threads 열기").disabled).toBe(true);
  });
  it("keeps handoff gated by approval, and re-locks it after editing", async () => {
    await render();
    await act(async () => useWorkflowStore.getState().loadDraft(draft, []));
    expect(host.querySelector(".editor-empty")).toBeNull();
    expect(host.querySelector('[aria-label="완성된 글 편집"]')).not.toBeNull();
    expect(button("복사하고 Threads 열기").disabled).toBe(true);
    expect(host.querySelector(".safe")?.textContent).toContain("직접 확인");
    await act(async () => button("최종 승인 저장").click());
    expect(button("복사하고 Threads 열기").disabled).toBe(false);
    await act(async () => useWorkflowStore.getState().edit("수정한 내용"));
    expect(button("복사하고 Threads 열기").disabled).toBe(true);
    expect(button("되돌리기").disabled).toBe(false);
    await act(async () => button("되돌리기").click());
    expect(button("복사하고 Threads 열기").disabled).toBe(false);
  });
  it("places collapsed candidates after the editable result", async () => {
    await render();
    await act(async () =>
      useWorkflowStore.getState().loadDraft(draft, [
        {
          id: "candidate-layout",
          angle: "checklist",
          hook: "검토",
          body: "본문",
          cta: "확인",
          text: draft.text,
          rationale: "검토 절차 중심",
          riskFlags: [],
          score: draft.score,
        },
      ]),
    );
    const editor = host.querySelector(".editor-card")!;
    const candidates =
      host.querySelector<HTMLDetailsElement>(".candidate-review")!;
    expect(candidates.open).toBe(false);
    expect(
      editor.compareDocumentPosition(candidates) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });
  it("keeps extension-only capture and the runtime-specific shell", async () => {
    await render("extension");
    expect(host.querySelector(".shell-extension")).not.toBeNull();
    expect(button("현재 글 가져오기").disabled).toBe(false);
    expect(button("1턴으로 완성하기").disabled).toBe(false);
  });
});
