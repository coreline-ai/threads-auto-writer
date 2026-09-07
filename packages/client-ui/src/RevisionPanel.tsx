import { useEffect, useMemo, useRef, useState } from "react";
import { diffWords } from "@threadflow-os/shared/diff";
import type { FinalDraft } from "@threadflow-os/contracts";
type Scope = "hook" | "cta" | "full";
type Props = {
  disabled?: boolean;
  contextKey: string;
  text: string;
  request(
    scope: Scope,
    feedback: string,
    baseText: string,
  ): Promise<FinalDraft>;
  onApply(text: string): void;
  onBusy(busy: boolean): void;
};
export function RevisionPanel({
  disabled = false,
  contextKey,
  text,
  request,
  onApply,
  onBusy,
}: Props) {
  const [scope, setScope] = useState<Scope>("full");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    base: string;
    context: string;
    draft: FinalDraft;
  } | null>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const latest = useRef({ contextKey, text });
  latest.current = { contextKey, text };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const stale =
    preview !== null &&
    (preview.base !== text || preview.context !== contextKey);
  const diff = useMemo(
    () => (preview ? diffWords(preview.base, preview.draft.text) : []),
    [preview],
  );
  async function submit() {
    if (disabled || pending.current || !text.trim() || !feedback.trim()) return;
    const base = text;
    const context = contextKey;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setPreview(null);
    try {
      const draft = await request(scope, feedback.trim(), base);
      if (alive.current) setPreview({ base, context, draft });
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "수정안을 가져오지 못했습니다.",
        );
    } finally {
      pending.current = false;
      onBusy(false);
      if (alive.current) setBusy(false);
    }
  }
  function apply() {
    if (
      disabled ||
      !preview ||
      pending.current ||
      latest.current.text !== preview.base ||
      latest.current.contextKey !== preview.context
    )
      return;
    onApply(preview.draft.text);
    setPreview(null);
  }
  return (
    <details className="revision-panel">
      <summary>
        AI와 다듬기 <small>비교한 뒤 직접 적용</small>
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          수정 범위
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            disabled={disabled || busy}
          >
            <option value="full">전체 글</option>
            <option value="hook">첫 문장</option>
            <option value="cta">마무리</option>
          </select>
        </label>
        <label>
          수정 요청
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={2000}
            rows={2}
            disabled={disabled || busy}
            placeholder="예: 내용은 유지하고 더 간결하게 다듬어줘"
          />
        </label>
        <div className="revision-presets">
          {["더 짧게", "과장 없이", "자연스러운 말투로"].map((value) => (
            <button
              type="button"
              key={value}
              disabled={disabled || busy}
              onClick={() =>
                setFeedback(`현재 내용을 유지하고 ${value} 다듬어 주세요.`)
              }
            >
              {value}
            </button>
          ))}
        </div>
        <button
          className="secondary"
          disabled={
            disabled || busy || !text.trim() || !feedback.trim() || !contextKey
          }
        >
          {busy ? "수정안 작성 중…" : "수정안 미리보기"}
        </button>
      </form>
      {error && (
        <p role="alert" className="revision-error">
          {error} 현재 글과 요청은 보존했습니다.
        </p>
      )}
      {preview && (
        <section aria-label="수정안 비교" className="revision-preview">
          <p>
            추가된 부분과 삭제된 부분을 비교하세요. 아직 본문에 적용되지
            않았습니다.
          </p>
          <div className="version-diff">
            {diff.map((chunk, i) => (
              <span className={chunk.type} key={i}>
                {chunk.value}
              </span>
            ))}
          </div>
          {preview.draft.riskFlags.map((flag, i) => (
            <p className="revision-error" key={i}>
              {flag.message}
            </p>
          ))}
          {stale && (
            <p role="alert">
              본문이 바뀌어 이 수정안을 적용할 수 없습니다. 현재 본문으로 다시
              요청하세요.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setPreview(null)}
            >
              수정안 버리기
            </button>
            <button
              type="button"
              className="primary"
              disabled={disabled || stale || busy}
              onClick={apply}
            >
              본문에 적용
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
