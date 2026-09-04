import { Dexie, type EntityTable, type Table } from "dexie";
import type {
  DraftCandidate,
  FinalDraft,
  GenerationRequest,
  Persona,
  SourceSnapshot,
  WritingMode,
} from "@threadflow-os/contracts";
import type { WorkflowSnapshot } from "../features/workflow-store.js";

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
    return {
      personas: await this.personas.toArray(),
      sources: await this.sources.toArray(),
      drafts: await this.drafts.toArray(),
      generations: await this.generations.toArray(),
      calendarSlots: await this.calendarSlots.toArray(),
      edits: await this.edits.toArray(),
      publicationLinks: await this.publicationLinks.toArray(),
      workspaceStates: await this.workspaceStates.toArray(),
      settings: (await this.settings.toArray()).filter(
        (setting) => setting.key !== "bootstrapSecret",
      ),
    };
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
      ],
      async () => Promise.all(this.tables.map((table) => table.clear())),
    );
  }
}

export const db = new ThreadFlowDatabase();
