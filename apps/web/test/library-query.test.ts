import { describe, expect, it } from "vitest";
import { queryLibrary } from "../../../packages/client-ui/src/library-query.js";
import type { StoredDraft } from "../../../packages/client-ui/src/database.js";
import type { WorkingDraft } from "../../../packages/client-ui/src/draft-workspaces.js";
function draft(id: string, version = 1, text = "본문"): StoredDraft {
  return {
    id,
    version,
    text,
    updatedAt: `2026-09-${String(Math.min(28, version)).padStart(2, "0")}T00:00:00.000Z`,
    finalDraft: { id, text, approvalStatus: "APPROVED" },
    candidates: [],
  } as StoredDraft;
}
function work(row: StoredDraft, text = row.text): WorkingDraft {
  return {
    id: "work-" + row.id,
    revision: 1,
    snapshot: {
      sourceText: "",
      sourceUrl: "",
      evidence: "",
      updatedAt: row.updatedAt,
      workflow: { editorText: text, finalDraft: row.finalDraft },
    },
  } as WorkingDraft;
}
describe("complete local library query", () => {
  it("handles 0/1/31/200 records and searches beyond the old thirty-item limit", () => {
    for (const count of [0, 1, 31, 200]) {
      const rows = Array.from({ length: count }, (_, i) =>
        draft(String(i), 1, `항목 ${i} 끝`),
      );
      expect(queryLibrary([], rows)).toHaveLength(count);
      if (count)
        expect(queryLibrary([], rows, `항목 ${count - 1} 끝`)).toHaveLength(1);
    }
  });
  it("groups versions and identifies a hit that exists only in an older version", () => {
    const rows = [draft("a", 1, "과거 유니콘"), draft("a", 2, "현재 문장")];
    expect(queryLibrary([], rows)).toHaveLength(1);
    expect(queryLibrary([], rows)[0].draft?.version).toBe(2);
    expect(queryLibrary([], rows, "유니콘")[0]).toMatchObject({
      historical: true,
      draft: { version: 1 },
    });
  });
  it("does not duplicate linked approved records or label an edited working copy approved", () => {
    const saved = draft("a");
    const changed = work(saved, "편집 중");
    expect(queryLibrary([changed], [saved])).toHaveLength(1);
    expect(queryLibrary([changed], [saved])[0].status).toBe("writing");
    expect(queryLibrary([changed], [saved], "", "approved")).toHaveLength(0);
    expect(queryLibrary([work(saved)], [saved], "", "approved")).toHaveLength(
      1,
    );
  });
  it("keeps current status for a historical match and distinguishes work branches", () => {
    const saved = draft("a", 1, "과거 유니콘");
    const changed = work(saved, "최신 글");
    const result = queryLibrary([changed], [saved], "유니콘");
    expect(result[0]).toMatchObject({
      status: "writing",
      historical: true,
      draft: { version: 1 },
    });
    expect(
      queryLibrary([changed, { ...changed, id: "branch" }], [saved]),
    ).toHaveLength(2);
  });
  it("normalizes Korean whitespace, case and emoji and supports status changes", () => {
    const row = draft("a", 1, "한글   문장\nHello 🌿");
    for (const q of ["한글 문장", "HELLO", "🌿", "  "])
      expect(queryLibrary([], [row], q)).toHaveLength(1);
    expect(queryLibrary([], [row], "없는 글")).toHaveLength(0);
    expect(queryLibrary([], [row], "", "writing")).toHaveLength(0);
    expect(queryLibrary([work(row, "")], [row])[0].status).toBe("writing");
  });
  it("excludes truly empty temporary work and includes pre-generation notes", () => {
    const row = work(draft("a"));
    row.snapshot.workflow.finalDraft = null;
    row.snapshot.workflow.editorText = "";
    expect(queryLibrary([row], [])).toHaveLength(0);
    row.snapshot.sourceText = "메모";
    expect(queryLibrary([row], [], "메모")).toHaveLength(1);
  });
});
