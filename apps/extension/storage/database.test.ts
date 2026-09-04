// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadFlowDatabase } from "./database.js";

const finalDraft = {
  id: "draft-1",
  generationId: "g",
  selectedCandidateId: "c",
  text: "draft",
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
  approvalStatus: "DRAFT" as const,
  promptVersion: "2.0.0",
  rubricVersion: "1.0.0",
  createdAt: new Date().toISOString(),
  approvedAt: null,
};

describe("extension local database", () => {
  const databases: ThreadFlowDatabase[] = [];
  afterEach(async () =>
    Promise.all(databases.map((database) => database.delete())),
  );

  it("stores versions and detects conflicts", async () => {
    const database = new ThreadFlowDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const base = {
      id: "draft-1",
      generationId: "g",
      text: "draft",
      finalDraft,
      candidates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect((await database.saveDraftVersion(base)).version).toBe(1);
    await expect(
      database.saveDraftVersion({ ...base, text: "changed" }, 0),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(
      (await database.saveDraftVersion({ ...base, text: "changed" }, 1))
        .version,
    ).toBe(2);
  });

  it("excludes bootstrap secrets from export and deletes all data", async () => {
    const database = new ThreadFlowDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    await database.settings.bulkPut([
      { key: "bootstrapSecret", value: "secret" },
      { key: "theme", value: "dark" },
    ]);
    await database.publicationLinks.put({
      draftId: "draft-1",
      url: "https://www.threads.com/@user/post/1",
      linkedAt: new Date().toISOString(),
    });
    expect(await database.exportAll()).toMatchObject({
      settings: [{ key: "theme", value: "dark" }],
      publicationLinks: [
        {
          draftId: "draft-1",
          url: "https://www.threads.com/@user/post/1",
        },
      ],
    });
    await database.deleteAllUserData();
    expect(await database.settings.count()).toBe(0);
    expect(await database.publicationLinks.count()).toBe(0);
  });

  it("restores a Persona and Draft after the database is reopened", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const database = new ThreadFlowDatabase(name);
    await database.personas.put({
      id: "persona-1",
      name: "실무자",
      audience: "독자",
      voice: "간결하게",
      goals: [],
      bannedPhrases: [],
      preferredLength: { min: 20, max: 500 },
      language: "ko-KR",
    });
    await database.saveDraftVersion({
      id: "draft-1",
      generationId: "g",
      text: "draft",
      finalDraft,
      candidates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    database.close();
    const reopened = new ThreadFlowDatabase(name);
    databases.push(reopened);
    expect((await reopened.personas.get("persona-1"))?.name).toBe("실무자");
    expect(await reopened.drafts.where("id").equals("draft-1").count()).toBe(1);
  });

  it("updates one source snapshot by id and preserves intentional recaptures", async () => {
    const database = new ThreadFlowDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const source = {
      id: "source-1",
      text: "같은 본문",
      author: "writer",
      url: "https://www.threads.com/@writer/post/abc",
      capturedAt: "2026-09-04T00:00:00.000Z",
      captureMethod: "article" as const,
      adapterVersion: "threads-web-v1",
    };
    await database.sources.put(source);
    await database.sources.put({ ...source, text: "일부 수정 본문" });
    expect(await database.sources.count()).toBe(1);
    expect((await database.sources.get(source.id))?.text).toBe(
      "일부 수정 본문",
    );

    await database.sources.put({ ...source, id: "source-2" });
    expect(await database.sources.count()).toBe(2);
  });

  it("restores and deletes an unsaved writing workspace", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const database = new ThreadFlowDatabase(name);
    await database.workspaceStates.put({
      id: "current",
      view: "write",
      purpose: "복구 테스트",
      sourceUrl: "",
      sourceText: "저장 전 참고 글",
      mode: "new",
      variationStrength: 0.8,
      candidateCount: 4,
      evidence: "",
      persona: {
        id: "persona-1",
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
      workflow: {
        source: null,
        generationId: null,
        stage: "IDLE",
        candidates: [],
        finalDraft: null,
        editorText: "저장 전 편집 글",
        history: [],
        future: [],
        error: null,
      },
      updatedAt: new Date().toISOString(),
    });
    database.close();
    const reopened = new ThreadFlowDatabase(name);
    databases.push(reopened);
    expect((await reopened.workspaceStates.get("current"))?.sourceText).toBe(
      "저장 전 참고 글",
    );
    await reopened.deleteAllUserData();
    expect(await reopened.workspaceStates.count()).toBe(0);
  });
});
