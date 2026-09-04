import { create } from "zustand";
import type {
  DraftCandidate,
  FinalDraft,
  GenerationEvent,
  GenerationState,
  SourceSnapshot,
} from "@threadflow-os/contracts";

export type WorkflowStage = GenerationState | "IDLE";

export type WorkflowSnapshot = {
  source: SourceSnapshot | null;
  generationId: string | null;
  stage: WorkflowStage;
  candidates: DraftCandidate[];
  finalDraft: FinalDraft | null;
  editorText: string;
  history: string[];
  future: string[];
  error: string | null;
};

type WorkflowStore = WorkflowSnapshot & {
  setSource(source: SourceSnapshot): void;
  loadDraft(draft: FinalDraft, candidates: DraftCandidate[]): void;
  begin(id: string): void;
  applyEvent(event: GenerationEvent): void;
  restore(snapshot: WorkflowSnapshot): void;
  fail(message: string): void;
  cancelLocal(): void;
  approve(draft: FinalDraft): void;
  edit(text: string): void;
  undo(): void;
  redo(): void;
  clear(): void;
};

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  source: null,
  generationId: null,
  stage: "IDLE",
  candidates: [],
  finalDraft: null,
  editorText: "",
  history: [],
  future: [],
  error: null,
  setSource: (source) => set({ source }),
  loadDraft: (draft, candidates) =>
    set({
      generationId: draft.generationId,
      stage: "COMPLETED",
      candidates,
      finalDraft: draft,
      editorText: draft.text,
      history: [],
      future: [],
      error: null,
    }),
  begin: (generationId) =>
    set({
      generationId,
      stage: "QUEUED",
      candidates: [],
      finalDraft: null,
      editorText: "",
      history: [],
      future: [],
      error: null,
    }),
  applyEvent: (event) =>
    set((state) => {
      if (event.type === "state") return { ...state, stage: event.state };
      if (event.type === "error")
        return { ...state, error: event.message, stage: "FAILED" };
      if (event.type === "result")
        return {
          ...state,
          candidates: event.candidates,
          finalDraft: event.finalDraft,
          editorText: event.finalDraft.text,
          history: [],
          future: [],
        };
      return state;
    }),
  restore: (snapshot) =>
    set({
      ...snapshot,
      history: snapshot.history.slice(-50),
      future: snapshot.future.slice(0, 50),
    }),
  fail: (message) => set({ error: message, stage: "FAILED" }),
  cancelLocal: () => set({ stage: "CANCELED" }),
  approve: (draft) =>
    set({
      finalDraft: draft,
      editorText: draft.text,
      history: [],
      future: [],
    }),
  edit: (text) =>
    set((state) => ({
      editorText: text,
      history: [...state.history.slice(-49), state.editorText],
      future: [],
    })),
  undo: () =>
    set((state) => {
      const previous = state.history.at(-1);
      if (previous === undefined) return state;
      return {
        editorText: previous,
        history: state.history.slice(0, -1),
        future: [state.editorText, ...state.future],
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        editorText: next,
        history: [...state.history, state.editorText],
        future: state.future.slice(1),
      };
    }),
  clear: () =>
    set({
      source: null,
      generationId: null,
      stage: "IDLE",
      candidates: [],
      finalDraft: null,
      editorText: "",
      history: [],
      future: [],
      error: null,
    }),
}));
