import type { ThreadFlowDatabase, WorkspaceState } from "./database.js";
import {
  FinalDraftSchema,
  DraftCandidateSchema,
  GenerationRequestSchema,
  SourceSnapshotSchema,
} from "@threadflow-os/contracts";

export type WorkspaceSnapshot = Omit<WorkspaceState, "id"> & {
  image?: { name: string; size: number; altText: string } | null;
};
export type WorkingDraft = {
  id: string;
  revision: number;
  snapshot: WorkspaceSnapshot;
};
export const ACTIVE_WORK_KEY = "activeWorkingDraft";

// Validate structure, not unfinished input content (an empty purpose is valid while editing).
export function validateWorkspace(value: unknown): WorkspaceSnapshot {
  const s = value as WorkspaceSnapshot | undefined;
  const w = s?.workflow;
  const p = s?.persona;
  if (
    !s ||
    !w ||
    !p ||
    !["write", "library", "calendar", "settings"].includes(s.view) ||
    !["new", "polish", "affiliate", "shorten", "alternate-angle"].includes(
      s.mode,
    ) ||
    ![
      s.purpose,
      s.sourceUrl,
      s.sourceText,
      s.evidence,
      s.updatedAt,
      w.editorText,
      p.id,
      p.name,
      p.audience,
      p.voice,
      p.language,
    ].every((v) => typeof v === "string") ||
    ![
      s.variationStrength,
      s.candidateCount,
      p.preferredLength?.min,
      p.preferredLength?.max,
    ].every((v) => typeof v === "number" && Number.isFinite(v)) ||
    ![p.goals, p.bannedPhrases, w.history, w.future].every(
      (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
    ) ||
    !Array.isArray(w.candidates) ||
    !w.candidates.every((v) => DraftCandidateSchema.safeParse(v).success) ||
    (w.finalDraft !== null &&
      !FinalDraftSchema.safeParse(w.finalDraft).success) ||
    (w.source !== null && !SourceSnapshotSchema.safeParse(w.source).success) ||
    (s.activeRequest !== null &&
      !GenerationRequestSchema.safeParse(s.activeRequest).success) ||
    ![
      "IDLE",
      "QUEUED",
      "ANALYZING",
      "STRATEGIZING",
      "GENERATING",
      "CRITIQUING",
      "REFINING",
      "CHECKING",
      "COMPLETED",
      "FAILED",
      "CANCELED",
    ].includes(w.stage) ||
    !(w.generationId === null || typeof w.generationId === "string") ||
    !(w.error === null || typeof w.error === "string") ||
    !(
      s.selectedCandidateId === null ||
      typeof s.selectedCandidateId === "string"
    ) ||
    (s.image != null &&
      !(
        typeof s.image.name === "string" &&
        typeof s.image.size === "number" &&
        typeof s.image.altText === "string"
      ))
  )
    throw new Error(
      "저장된 작업 형식이 손상되었습니다. 설정에서 내보내기로 원본을 보관하세요.",
    );
  const snapshot = { ...s };
  delete (snapshot as Partial<WorkspaceState>).id;
  return snapshot;
}

export class DraftSession {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private database: ThreadFlowDatabase,
    readonly id: string,
    private revision = 0,
  ) {}
  save(snapshot: WorkspaceSnapshot): Promise<WorkingDraft> {
    const captured = structuredClone(snapshot);
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const saved = await this.database.saveWorkingDraft(
          this.id,
          captured,
          this.revision,
        );
        this.revision = saved.revision;
        return saved;
      });
    this.queue = task;
    return task;
  }
  async drain() {
    await this.queue.catch(() => {});
  }
}

export function freshWorkspace(current: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...current,
    view: "write",
    sourceText: "",
    sourceUrl: "",
    evidence: "",
    image: null,
    activeRequest: null,
    selectedCandidateId: null,
    workflow: {
      source: null,
      generationId: null,
      stage: "IDLE",
      candidates: [],
      finalDraft: null,
      editorText: "",
      history: [],
      future: [],
      error: null,
    },
    updatedAt: new Date().toISOString(),
  };
}
