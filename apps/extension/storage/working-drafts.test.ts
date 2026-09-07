// @vitest-environment node
import "fake-indexeddb/auto";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadFlowDatabase } from "./database.js";
import {
  DraftSession,
  freshWorkspace,
  validateWorkspace,
  type WorkspaceSnapshot,
} from "../../../packages/client-ui/src/draft-workspaces.js";

// Use the shared client package's Dexie runtime to construct the historical schema.
const { Dexie } = createRequire(
  new URL("../../../packages/client-ui/package.json", import.meta.url),
)("dexie") as { Dexie: typeof ThreadFlowDatabase };
const databases: ThreadFlowDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.delete();
});
function database() {
  const db = new ThreadFlowDatabase("working-" + crypto.randomUUID());
  databases.push(db);
  return db;
}
const sample = (): WorkspaceSnapshot => ({
  view: "write",
  purpose: "목적",
  sourceUrl: "",
  sourceText: "입력 글",
  mode: "new",
  variationStrength: 0.8,
  candidateCount: 4,
  evidence: "근거",
  persona: {
    id: "persona-default",
    name: "실무자",
    audience: "독자",
    voice: "간결하게",
    goals: [],
    bannedPhrases: [],
    preferredLength: { min: 20, max: 500 },
    language: "ko-KR",
  },
  activeRequest: null,
  selectedCandidateId: null,
  image: { name: "a.png", size: 100, altText: "대체 텍스트" },
  workflow: {
    source: null,
    generationId: null,
    stage: "IDLE",
    candidates: [],
    finalDraft: null,
    editorText: "편집 본문",
    history: ["이전 글"],
    future: [],
    error: null,
  },
  updatedAt: "2026-09-06T00:00:00.000Z",
});
async function legacy(name: string, snapshot: unknown) {
  const old = new Dexie(name);
  old.version(3).stores({
    personas: "id, name",
    sources: "id, capturedAt, url",
    drafts: "[id+version], id, updatedAt, generationId",
    generations: "id, state, startedAt",
    calendarSlots: "id, scheduledAt, status, draftId",
    edits: "id, draftId, createdAt",
    settings: "key",
    publicationLinks: "draftId, linkedAt",
    workspaceStates: "id, updatedAt",
  });
  await old
    .table("workspaceStates")
    .put({ id: "current", ...(snapshot as object) });
  await old.table("settings").put({ key: "bootstrapSecret", value: "private" });
  await old
    .table("drafts")
    .put({ id: "existing", version: 1, text: "기존 승인본" });
  await old
    .table("publicationLinks")
    .put({ draftId: "existing", url: "https://www.threads.com/@test/post/a" });
  old.close();
}
describe("working draft integrity", () => {
  it("migrates v3 transactionally and keeps the legacy backup, approved versions and key", async () => {
    const name = "migration-" + crypto.randomUUID();
    await legacy(name, sample());
    const db = new ThreadFlowDatabase(name);
    databases.push(db);
    const work = await db.loadActiveWorkspace();
    expect(work?.snapshot).toEqual(sample());
    expect(work?.revision).toBe(1);
    expect(await db.workspaceStates.count()).toBe(1);
    expect(await db.drafts.count()).toBe(1);
    expect(await db.publicationLinks.count()).toBe(1);
    expect((await db.settings.get("bootstrapSecret"))?.value).toBe("private");
    db.close();
    const reopened = new ThreadFlowDatabase(name);
    expect((await reopened.loadActiveWorkspace())?.id).toBe(work?.id);
    reopened.close();
  });
  it("rolls a failed migration back and can migrate again on reopen", async () => {
    const name = "retry-" + crypto.randomUUID();
    await legacy(name, sample());
    const db = new ThreadFlowDatabase(name);
    databases.push(db);
    const failure = vi
      .spyOn(Object.getPrototypeOf(db.workingDrafts), "add")
      .mockRejectedValueOnce(new Error("quota migration"));
    await expect(db.open()).rejects.toThrow("quota migration");
    failure.mockRestore();
    db.close();
    const reopened = new ThreadFlowDatabase(name);
    expect((await reopened.loadActiveWorkspace())?.snapshot.sourceText).toBe(
      "입력 글",
    );
    expect(await reopened.drafts.count()).toBe(1);
    reopened.close();
  });
  it("fails closed on corrupt legacy data across reopening without deleting it", async () => {
    const name = "corrupt-" + crypto.randomUUID();
    await legacy(name, { ...sample(), workflow: { history: null } });
    const db = new ThreadFlowDatabase(name);
    databases.push(db);
    await expect(db.loadActiveWorkspace()).rejects.toThrow("손상");
    expect(await db.workingDrafts.count()).toBe(0);
    expect(await db.workspaceStates.count()).toBe(1);
    db.close();
    const again = new ThreadFlowDatabase(name);
    await expect(again.loadActiveWorkspace()).rejects.toThrow("손상");
    expect((await again.exportAll()).workspaceStates).toHaveLength(1);
    again.close();
  });
  it("starts empty, saves and restores multiple distinct workspaces", async () => {
    const db = database();
    expect(await db.loadActiveWorkspace()).toBeUndefined();
    const a = await db.saveWorkingDraft("a", sample(), 0);
    const fresh = freshWorkspace(sample());
    expect(fresh).toMatchObject({
      sourceText: "",
      sourceUrl: "",
      evidence: "",
      image: null,
      activeRequest: null,
      workflow: { editorText: "", history: [], finalDraft: null },
    });
    expect(fresh.persona).toEqual(sample().persona);
    expect(fresh.purpose).toBe(sample().purpose);
    await db.saveWorkingDraft("b", fresh, 0);
    expect((await db.loadActiveWorkspace())?.id).toBe("b");
    expect(
      (await db.workingDrafts.get(a.id))?.snapshot.workflow.editorText,
    ).toBe("편집 본문");
  });
  it("serializes delayed saves and captures the snapshot at enqueue time", async () => {
    const db = database(),
      session = new DraftSession(db, "a");
    const first = sample();
    const a = session.save(first);
    first.workflow.editorText = "mutation must not leak";
    const b = session.save({ ...sample(), sourceText: "두 번째" });
    expect((await a).snapshot.workflow.editorText).toBe("편집 본문");
    expect((await b).revision).toBe(2);
    expect((await db.workingDrafts.get("a"))?.snapshot.sourceText).toBe(
      "두 번째",
    );
  });
  it("rejects a different tab's stale revision without overwriting its work", async () => {
    const db = database();
    const a = new DraftSession(db, "a");
    await a.save(sample());
    const b = new DraftSession(db, "a", 1);
    await a.save({ ...sample(), sourceText: "탭 A 최신" });
    await expect(b.save({ ...sample(), sourceText: "탭 B" })).rejects.toThrow(
      "WORKSPACE_CONFLICT",
    );
    await expect(
      b.save({ ...sample(), sourceText: "재시도도 덮어쓰기 금지" }),
    ).rejects.toThrow("WORKSPACE_CONFLICT");
    expect((await db.workingDrafts.get("a"))?.snapshot.sourceText).toBe(
      "탭 A 최신",
    );
  });
  it("does not advance a session revision after quota failure and permits a safe retry", async () => {
    const db = database(),
      session = new DraftSession(db, "a");
    vi.spyOn(db, "saveWorkingDraft").mockRejectedValueOnce(new Error("quota"));
    await expect(session.save(sample())).rejects.toThrow("quota");
    expect((await session.save(sample())).revision).toBe(1);
  });
  it("exports working drafts without credentials and deletes every table", async () => {
    const db = database();
    await db.saveWorkingDraft("a", sample(), 0);
    await db.settings.put({ key: "bootstrapSecret", value: "private" });
    const exported = await db.exportAll();
    expect(exported.workingDrafts).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain("private");
    await db.deleteAllUserData();
    expect(await db.workingDrafts.count()).toBe(0);
    expect(await db.settings.count()).toBe(0);
    expect(await db.loadActiveWorkspace()).toBeUndefined();
  });
  it("validates structural damage while allowing unfinished input fields", () => {
    expect(
      validateWorkspace({
        ...sample(),
        purpose: "",
        persona: { ...sample().persona, voice: "" },
      }).purpose,
    ).toBe("");
    expect(() =>
      validateWorkspace({
        ...sample(),
        workflow: { ...sample().workflow, history: null },
      }),
    ).toThrow("손상");
  });
});
