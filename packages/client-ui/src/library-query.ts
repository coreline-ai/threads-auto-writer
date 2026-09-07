import type { StoredDraft } from "./database.js";
import type { WorkingDraft } from "./draft-workspaces.js";
export type LibraryStatus = "all" | "writing" | "approved";
export type LibraryEntry = {
  key: string;
  title: string;
  text: string;
  updatedAt: string;
  status: Exclude<LibraryStatus, "all">;
  work?: WorkingDraft;
  draft?: StoredDraft | undefined;
  historical: boolean;
};
const normalize = (text: string) =>
  text.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
const approved = (text: string, final: StoredDraft["finalDraft"] | null) =>
  !!text.trim() && final?.approvalStatus === "APPROVED" && final.text === text;
const title = (text: string) =>
  text
    .trim()
    .split(/\n/u)
    .find((line) => line.trim())
    ?.slice(0, 80) ?? "빈 작업";

export function queryLibrary(
  works: WorkingDraft[],
  drafts: StoredDraft[],
  query = "",
  status: LibraryStatus = "all",
): LibraryEntry[] {
  const needle = normalize(query);
  const matches = (text: string) => !needle || normalize(text).includes(needle);
  const groups = new Map<string, StoredDraft[]>();
  for (const draft of drafts)
    groups.set(draft.id, [...(groups.get(draft.id) ?? []), draft]);
  for (const versions of groups.values())
    versions.sort((a, b) => b.version - a.version);
  const linked = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const work of works) {
    const s = work.snapshot,
      w = s.workflow;
    const id = w.finalDraft?.id;
    if (id) linked.add(id);
    const versions = id ? (groups.get(id) ?? []) : [];
    const currentText = w.editorText || s.sourceText || s.sourceUrl;
    if (!currentText.trim() && !w.finalDraft) continue;
    const currentMatch = matches(
      [w.editorText, s.sourceText, s.evidence].join("\n"),
    );
    const past = currentMatch
      ? undefined
      : versions.find((d) => matches(d.text));
    if (!currentMatch && !past) continue;
    const text = past?.text ?? currentText;
    entries.push({
      key: work.id,
      work,
      draft: past ?? versions[0],
      historical: !!past,
      title: title(text),
      text,
      updatedAt: s.updatedAt,
      status: approved(w.editorText, w.finalDraft) ? "approved" : "writing",
    });
  }
  for (const [id, versions] of groups) {
    if (linked.has(id)) continue;
    const latest = versions[0];
    if (!latest) continue;
    const match = versions.find((d) => matches(d.text));
    if (!match) continue;
    entries.push({
      key: id,
      draft: match,
      historical: match.version !== latest.version,
      title: title(match.text),
      text: match.text,
      updatedAt: latest.updatedAt,
      status: approved(latest.text, latest.finalDraft) ? "approved" : "writing",
    });
  }
  return entries
    .filter((e) => status === "all" || e.status === status)
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key),
    );
}
