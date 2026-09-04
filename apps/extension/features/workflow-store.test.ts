import { beforeEach, describe, expect, it } from "vitest";
import { useWorkflowStore } from "./workflow-store.js";

describe("workflow editor history", () => {
  beforeEach(() => useWorkflowStore.getState().clear());

  it("preserves user edits across undo and redo", () => {
    useWorkflowStore.getState().edit("첫 문장");
    useWorkflowStore.getState().edit("둘째 문장");
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().editorText).toBe("첫 문장");
    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().editorText).toBe("둘째 문장");
  });

  it("clears stale editor state when a new generation starts", () => {
    useWorkflowStore.getState().edit("이전 편집본");
    useWorkflowStore.getState().begin("generation-new");
    expect(useWorkflowStore.getState()).toMatchObject({
      generationId: "generation-new",
      stage: "QUEUED",
      editorText: "",
      history: [],
      future: [],
    });
  });
});
