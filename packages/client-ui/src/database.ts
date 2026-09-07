import {
  ACTIVE_WORK_KEY,
  validateWorkspace,
  type WorkingDraft,
  type WorkspaceSnapshot,
} from "./draft-workspaces.js";
import { Dexie, type EntityTable, type Table } from "dexie";
import type {
  DraftCandidate,
  FinalDraft,
  GenerationRequest,
  Persona,
  SourceSnapshot,
  WritingMode,
} from "@threadflow-os/contracts";
import type { WorkflowSnapshot } from "./workflow-store.js";

export type StoredDraft = {
  id: string;
  version: number;
  generationId: string;
  text: string;
  finalDraft: FinalDraft;
  candidates: DraftCandidate[];
  request?: GenerationRequest | null;
  createdAt: string;
  updatedAt: string;
  parentVersion: number | null;
};

export type GenerationMeta = {
  id: string;
  state: string;
  promptVersion: string | null;
  rubricVersion: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type CalendarSlot = {
  id: string;
  title: string;
  scheduledAt: string;
  timezone: string;
  draftId: string | null;
  status: "idea" | "draft" | "ready" | "published";
};

export type EditRecord = {
  id: string;
  draftId: string;
  beforeText: string;
  afterText: string;
  createdAt: string;
};

export type PublicationLink = {
  draftId: string;
  url: string;
  linkedAt: string;
};

export type Setting = { key: string; value: string };

export type WorkspaceState = {
  id: "current";
  view: "write" | "library" | "calendar" | "settings";
  purpose: string;
  sourceUrl: string;
  sourceText: string;
  mode: WritingMode;
  variationStrength: number;
  candidateCount: number;
  evidence: string;
  persona: Persona;
  activeRequest: GenerationRequest | null;
  selectedCandidateId: string | null;
  workflow: WorkflowSnapshot;
  updatedAt: string;
};

export class ThreadFlowDatabase extends Dexie {
  personas!: EntityTable<Persona, "id">;
  sources!: EntityTable<SourceSnapshot, "id">;
  drafts!: Table<StoredDraft, [string, number]>;
  generations!: EntityTable<GenerationMeta, "id">;
  calendarSlots!: EntityTable<CalendarSlot, "id">;
  edits!: EntityTable<EditRecord, "id">;
  publicationLinks!: EntityTable<PublicationLink, "draftId">;
  settings!: EntityTable<Setting, "key">;
  workingDrafts!: EntityTable<WorkingDraft, "id">;
  workspaceStates!: EntityTable<WorkspaceState, "id">;

  constructor(name = "threadflow-os") {
    super(name);
    this.version(1).stores({
      personas: "id, name",
      sources: "id, capturedAt, url",
      drafts: "[id+version], id, updatedAt, generationId",
      generations: "id, state, startedAt",
      calendarSlots: "id, scheduledAt, status, draftId",
      edits: "id, draftId, createdAt",
      settings: "key",
    });
    this.version(2).stores({
      publicationLinks: "draftId, linkedAt",
    });
    this.version(3).stores({
      workspaceStates: "id, updatedAt",
    });
    this.version(4)
      .stores({ workingDrafts: "id, snapshot.updatedAt" })
      .upgrade(async (tx) => {
        const legacy = await tx.table("workspaceStates").get("current");
        if (!legacy) return;
        let snapshot: WorkspaceSnapshot;
        try {
          snapshot = validateWorkspace(legacy);
        } catch {
          return;
        } // Keep the original for recovery; loadActiveWorkspace fails closed.
        const id = "migrated-current";
        await tx.table("workingDrafts").add({ id, revision: 1, snapshot });
        await tx.table("settings").put({ key: ACTIVE_WORK_KEY, value: id });
        // Retain the v3 backup, never write new state into it.
      });
  }

  async loadActiveWorkspace(): Promise<WorkingDraft | undefined> {
    const active = await this.settings.get(ACTIVE_WORK_KEY);
    if (active) {
      const row = await this.workingDrafts.get(active.value);
      if (!row)
        throw new Error(
          "활성 작업을 찾지 못했습니다. 내보내기로 데이터를 먼저 보관하세요.",
        );
      return { ...row, snapshot: validateWorkspace(row.snapshot) };
    }
    const legacy = await this.workspaceStates.get("current");
    if (legacy) {
      // Also supports a v3 client that wrote its backup after the schema upgrade.
      const snapshot = validateWorkspace(legacy);
      const row = await this.saveWorkingDraft("migrated-current", snapshot, 0);
      return row;
    }
    return undefined;
  }

  async saveWorkingDraft(
    id: string,
    snapshot: WorkspaceSnapshot,
    expectedRevision: number,
  ): Promise<WorkingDraft> {
    return this.transaction(
      "rw",
      [this.workingDrafts, this.settings],
      async () => {
        const previous = await this.workingDrafts.get(id);
        if ((previous?.revision ?? 0) !== expectedRevision)
          throw new Error(
            "WORKSPACE_CONFLICT: 다른 탭에서 이 작업이 변경됐습니다. 현재 글을 내보낸 뒤 새로고침하세요.",
          );
        const next = {
          id,
          snapshot: validateWorkspace(snapshot),
          revision: expectedRevision + 1,
        };
        await this.workingDrafts.put(next);
        if (!previous)
          await this.settings.put({ key: ACTIVE_WORK_KEY, value: id });
        return next;
      },
    );
  }

  async saveDraftVersion(
    input: Omit<StoredDraft, "version" | "parentVersion">,
    expectedVersion?: number,
  ): Promise<StoredDraft> {
    return this.transaction("rw", this.drafts, async () => {
      const versions = await this.drafts.where("id").equals(input.id).toArray();
      const current = versions.reduce(
        (max, item) => Math.max(max, item.version),
        0,
      );
      if (expectedVersion !== undefined && current !== expectedVersion)
        throw new Error("VERSION_CONFLICT");
      const next = {
        ...input,
        version: current + 1,
        parentVersion: current || null,
      };
      await this.drafts.add(next);
      return next;
    });
  }

  async exportAll(): Promise<Record<string, unknown[]>> {
    return this.transaction("r", this.tables, async () => ({
      personas: await this.personas.toArray(),
      sources: await this.sources.toArray(),
      drafts: await this.drafts.toArray(),
      generations: await this.generations.toArray(),
      calendarSlots: await this.calendarSlots.toArray(),
      edits: await this.edits.toArray(),
      publicationLinks: await this.publicationLinks.toArray(),
      workingDrafts: await this.workingDrafts.toArray(),
      workspaceStates: await this.workspaceStates.toArray(),
      settings: (await this.settings.toArray()).filter(
        (setting) => setting.key !== "bootstrapSecret",
      ),
    }));
  }

  async deleteAllUserData(): Promise<void> {
    await this.transaction(
      "rw",
      [
        this.personas,
        this.sources,
        this.drafts,
        this.generations,
        this.calendarSlots,
        this.edits,
        this.publicationLinks,
        this.settings,
        this.workspaceStates,
        this.workingDrafts,
      ],
      async () => Promise.all(this.tables.map((table) => table.clear())),
    );
  }
}

export const db = new ThreadFlowDatabase();
