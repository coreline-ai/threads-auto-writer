import { countThreadsTextUnits } from "@threadflow-os/contracts";

export function EditorActions({
  text,
  approved,
  blocking,
  warningCount,
  busy,
  extension,
  onApprove,
  onHandoff,
}: {
  text: string;
  approved: boolean;
  blocking: boolean;
  warningCount: number;
  busy: boolean;
  extension: boolean;
  onApprove(): void;
  onHandoff(): void;
}) {
  const count = countThreadsTextUnits(text);
  const invalid = !text.trim() || count > 500 || blocking;
  return (
    <footer className="editor-actions" aria-label="최종 글 작업">
      <div className="approval-heading">
        <b>
          {busy
            ? "처리 중…"
            : approved
              ? "승인 저장됨"
              : "마지막으로 읽고 승인해 주세요"}
        </b>
        <span>
          {count}/500자 ·{" "}
          {blocking || count > 500
            ? "확인 필요"
            : warningCount
              ? `참고 ${warningCount}건`
              : "자동 검사 통과"}
        </span>
      </div>
      <div className="actions">
        <button
          className="secondary"
          disabled={busy || invalid || approved}
          onClick={onApprove}
        >
          {approved ? "승인 저장됨" : "최종 승인 저장"}
        </button>
        <button
          className="primary"
          disabled={busy || invalid || !approved}
          onClick={onHandoff}
        >
          {extension ? "Threads 작성 화면으로" : "복사하고 Threads 열기"}
        </button>
      </div>
      <p className="safety-note">
        수정하면 재승인이 필요합니다. 게시·예약 확정은 직접 합니다.
      </p>
    </footer>
  );
}
