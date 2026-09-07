import { queryLibrary, type LibraryStatus } from "./library-query.js";
import {
  DraftSession,
  freshWorkspace,
  validateWorkspace,
  ACTIVE_WORK_KEY,
  type WorkingDraft,
  type WorkspaceSnapshot,
} from "./draft-workspaces.js";
import { EditorActions } from "./EditorActions.js";
import { RevisionPanel } from "./RevisionPanel.js";
import { ThemeControl } from "./ThemeControl.js";
import { appearance } from "./appearance.js";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  countThreadsTextUnits,
  FinalDraftSchema,
  GenerationRequestSchema,
  type GenerationRequest,
  type Persona,
  type RiskFlag,
  type SourceSnapshot,
  type WritingMode,
} from "@threadflow-os/contracts";
import {
  deterministicFlags,
  findRiskSentences,
} from "@threadflow-os/quality-engine/deterministic";
import { diffWords, type DiffChunk } from "@threadflow-os/shared/diff";
import { GatewayClient } from "./gateway-client.js";
import type { ClientRuntime, ComposerHandoffResult } from "./runtime.js";
import {
  db,
  type CalendarSlot,
  type PublicationLink,
  type StoredDraft,
} from "./database.js";
import { useWorkflowStore } from "./workflow-store.js";

const defaultPersona: Persona = {
  id: "persona-default",
  name: "차분한 실무자",
  audience: "실행 가능한 인사이트를 원하는 독자",
  voice: "짧고 명확하며 과장하지 않는 한국어",
  goals: ["읽은 뒤 한 가지 행동을 하게 한다"],
  bannedPhrases: ["무조건 성공", "100% 보장"],
  preferredLength: { min: 80, max: 700 },
  language: "ko-KR",
};

const defaultPurpose = "독자가 바로 실행할 수 있는 인사이트를 전달한다";
const activeGenerationStages = new Set([
  "QUEUED",
  "ANALYZING",
  "STRATEGIZING",
  "GENERATING",
  "CRITIQUING",
  "REFINING",
  "CHECKING",
]);

const stages: Record<string, string> = {
  QUEUED: "준비",
  ANALYZING: "구조 분석",
  STRATEGIZING: "전략 설계",
  GENERATING: "후보 작성",
  CRITIQUING: "편집장 평가",
  REFINING: "최종 개선",
  CHECKING: "위험 검수",
  COMPLETED: "완료",
  FAILED: "실패",
  CANCELED: "취소",
  IDLE: "대기",
};

type View = "write" | "library" | "calendar" | "settings";

type UiIconName =
  | "write"
  | "library"
  | "calendar"
  | "settings"
  | "capture"
  | "link"
  | "sparkle"
  | "audience"
  | "intensity"
  | "voice"
  | "evidence";

function UiIcon({
  name,
  className = "",
}: {
  name: UiIconName;
  className?: string;
}) {
  let content: ReactNode;

  switch (name) {
    case "write":
      content = (
        <>
          <path d="m4 16 1-4L14.5 2.5a2.1 2.1 0 0 1 3 3L8 15l-4 1Z" />
          <path d="m12.5 4.5 3 3M5 12l3 3" />
        </>
      );
      break;
    case "library":
      content = (
        <>
          <path d="M3 5h14v3H3zM4.5 8v9h11V8M8 11h4" />
        </>
      );
      break;
    case "calendar":
      content = (
        <>
          <rect x="3" y="4.5" width="14" height="13" rx="2" />
          <path d="M6.5 2.5v4M13.5 2.5v4M3 8.5h14M6.5 12h.01M10 12h.01M13.5 12h.01" />
        </>
      );
      break;
    case "settings":
      content = (
        <>
          <circle cx="10" cy="10" r="2.5" />
          <path d="M16.1 11.6a6.8 6.8 0 0 0 0-3.2l1.7-1.3-2-3.4-2 .8a7 7 0 0 0-2.8-1.6L10.7.7H6.8l-.3 2.2a7 7 0 0 0-2.8 1.6l-2-.8-2 3.4 1.7 1.3a6.8 6.8 0 0 0 0 3.2L-.3 13l2 3.4 2-.8a7 7 0 0 0 2.8 1.6l.3 2.2h3.9l.3-2.2a7 7 0 0 0 2.8-1.6l2 .8 2-3.4-1.7-1.4Z" />
        </>
      );
      break;
    case "capture":
      content = (
        <>
          <path d="M10 2v10M6.5 8.5 10 12l3.5-3.5" />
          <path d="M3 13v3.5h14V13" />
        </>
      );
      break;
    case "link":
      content = (
        <>
          <path d="m8.3 11.7 3.4-3.4" />
          <path d="M6.1 13.9 4.7 15.3a3.2 3.2 0 1 1-4.5-4.5l3.1-3.1a3.2 3.2 0 0 1 4.5 0M13.9 6.1l1.4-1.4a3.2 3.2 0 1 1 4.5 4.5l-3.1 3.1a3.2 3.2 0 0 1-4.5 0" />
        </>
      );
      break;
    case "sparkle":
      content = (
        <>
          <path d="M10 1.8c.5 4.8 1.9 6.2 6.7 6.7-4.8.5-6.2 1.9-6.7 6.7-.5-4.8-1.9-6.2-6.7-6.7C8.1 8 9.5 6.6 10 1.8Z" />
          <path d="M16.3 1.5c.2 1.5.7 2 2.2 2.2-1.5.2-2 .7-2.2 2.2-.2-1.5-.7-2-2.2-2.2 1.5-.2 2-.7 2.2-2.2Z" />
        </>
      );
      break;
    case "audience":
      content = (
        <>
          <circle cx="7" cy="7" r="3" />
          <circle cx="14.5" cy="8" r="2.3" />
          <path d="M1.8 17c.4-3.3 2.1-5 5.2-5s4.8 1.7 5.2 5M12 13c3.6-.8 5.6.5 6.2 3.5" />
        </>
      );
      break;
    case "intensity":
      content = (
        <>
          <path d="M4 16V11M10 16V7M16 16V3" />
          <rect x="2" y="11" width="4" height="5" rx="1" />
          <rect x="8" y="7" width="4" height="9" rx="1" />
          <rect x="14" y="3" width="4" height="13" rx="1" />
        </>
      );
      break;
    case "voice":
      content = (
        <>
          <path d="m4 16 1-4L14.5 2.5a2.1 2.1 0 0 1 3 3L8 15l-4 1Z" />
          <path d="m12.5 4.5 3 3" />
        </>
      );
      break;
    case "evidence":
      content = (
        <>
          <path d="M10 1.8 17 4v5.2c0 4.3-2.3 7.2-7 9-4.7-1.8-7-4.7-7-9V4l7-2.2Z" />
          <path d="m6.8 10 2.1 2.1 4.5-4.5" />
        </>
      );
      break;
  }

  return (
    <svg
      aria-hidden="true"
      className={`ui-icon ${className}`}
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.65"
      >
        {content}
      </g>
    </svg>
  );
}

export function App({ runtime }: { runtime: ClientRuntime }) {
  const hasExtensionRuntime = runtime.kind === "extension";
  const workflow = useWorkflowStore();
  const [view, setView] = useState<View>("write");
  const [purpose, setPurpose] = useState(defaultPurpose);
  const [sourceUrl, setSourceUrl] = useState("");
  const [mode, setMode] = useState<WritingMode>("new");
  const [variationStrength, setVariationStrength] = useState(0.8);
  const [candidateCount, setCandidateCount] = useState(4);
  const [evidence, setEvidence] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [persona, setPersona] = useState(defaultPersona);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [activeRequest, setActiveRequest] = useState<GenerationRequest | null>(
    null,
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("all");
  const [libraryPage, setLibraryPage] = useState(1);
  const [workingDrafts, setWorkingDrafts] = useState<WorkingDraft[]>([]);
  const [switching, setSwitching] = useState(false);
  const [workId, setWorkId] = useState("");
  const session = useRef<DraftSession | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const revisionLock = useRef(false);
  const [drafts, setDrafts] = useState<StoredDraft[]>([]);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [publicationLinks, setPublicationLinks] = useState<PublicationLink[]>(
    [],
  );
  const [versionDiff, setVersionDiff] = useState<{
    from: number;
    to: number;
    chunks: DiffChunk[];
  } | null>(null);
  const [image, setImage] = useState<{
    name: string;
    size: number;
    altText: string;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const actionLock = useRef(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [pendingAuthUrl, setPendingAuthUrl] = useState<string | null>(null);
  const deletingData = useRef(false);
  const resultRef = useRef<HTMLElement>(null);

  const gateway = useMemo(
    () =>
      new GatewayClient(
        "http://127.0.0.1:8787",
        async () => (await db.settings.get("bootstrapSecret"))?.value ?? "",
      ),
    [],
  );
  const auth = useQuery({
    queryKey: ["gateway-auth"],
    queryFn: () => gateway.status(),
    enabled: false,
    retry: false,
  });

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      runtime.getPendingCapture().then((source) => ({ source })),
      db.personas.get("persona-default"),
      db.settings.get("bootstrapSecret"),
      db.loadActiveWorkspace(),
    ])
      .then(async ([capture, savedPersona, secret, workspace]) => {
        if (disposed) return;
        session.current = new DraftSession(
          db,
          workspace?.id ?? crypto.randomUUID(),
          workspace?.revision ?? 0,
        );
        setWorkId(session.current.id);
        if (workspace) restoreWorkspace(workspace.snapshot);
        else if (savedPersona) setPersona(savedPersona);
        const source = (capture as { source?: SourceSnapshot })?.source;
        if (source) {
          workflow.setSource(source);
          setSourceText(source.text);
          setSourceUrl(source.url ?? "");
          void db.sources.put(source);
        }
        if (secret) setBootstrapSecret(secret.value);
        setHydrated(true);
        if (
          workspace?.snapshot.workflow.generationId &&
          activeGenerationStages.has(workspace.snapshot.workflow.stage)
        ) {
          void consumeGenerationEvents(
            workspace.snapshot.workflow.generationId,
          ).catch((error) => {
            if (
              session.current?.id !== workspace.id ||
              useWorkflowStore.getState().generationId !==
                workspace.snapshot.workflow.generationId
            )
              return;
            const message = readableError(
              error,
              "이전 생성 작업을 복구하지 못했습니다.",
            );
            workflow.fail(message);
            setNotice(
              `${message} 입력 내용은 보존했습니다. 다시 시작해 주세요.`,
            );
          });
        }
        if (secret) {
          const permitted = await runtime.hasGatewayPermission();
          if (permitted && !disposed) void auth.refetch();
        }
      })
      .catch((error) => {
        if (disposed) return;
        setSaveState("error");
        setNotice(
          readableError(
            error,
            "로컬 작업을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.",
          ),
        );
      });
    void refreshLibrary().catch(() =>
      setNotice("보관함을 읽지 못했습니다. 새로고침하세요."),
    );
    return () => {
      disposed = true;
    };
  }, []);

  const snapshot = useMemo<WorkspaceSnapshot>(
    () => ({
      view,
      purpose,
      sourceUrl,
      sourceText,
      mode,
      variationStrength,
      candidateCount,
      evidence,
      persona,
      activeRequest,
      selectedCandidateId,
      image,
      workflow: {
        source: workflow.source,
        generationId: workflow.generationId,
        stage: workflow.stage,
        candidates: workflow.candidates,
        finalDraft: workflow.finalDraft,
        editorText: workflow.editorText,
        history: workflow.history,
        future: workflow.future,
        error: workflow.error,
      },
      updatedAt: new Date().toISOString(),
    }),
    [
      view,
      purpose,
      sourceUrl,
      sourceText,
      mode,
      variationStrength,
      candidateCount,
      evidence,
      persona,
      activeRequest,
      selectedCandidateId,
      image,
      workflow.source,
      workflow.generationId,
      workflow.stage,
      workflow.candidates,
      workflow.finalDraft,
      workflow.editorText,
      workflow.history,
      workflow.future,
      workflow.error,
    ],
  );
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  useEffect(() => {
    if (!hydrated || deletingData.current || !session.current) return;
    let current = true;
    const target = session.current;
    setSaveState("saving");
    saveTimer.current = window.setTimeout(() => {
      void target.save(snapshot).then(
        () => {
          if (current) setSaveState("saved");
        },
        (error) => {
          if (current) {
            setSaveState("error");
            setNotice(
              readableError(
                error,
                "로컬 저장에 실패했습니다. 현재 글은 내보내기로 보관하세요.",
              ),
            );
          }
        },
      );
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(saveTimer.current);
    };
  }, [snapshot, hydrated, workId]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState !== "saved" && hydrated) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState, hydrated]);

  async function flushWorkspace() {
    window.clearTimeout(saveTimer.current);
    if (!hydrated || !session.current)
      throw new Error("작업 복구가 끝나지 않았습니다.");
    try {
      const captured = latestSnapshot.current;
      await session.current.save(captured);
      setSaveState(latestSnapshot.current === captured ? "saved" : "saving");
    } catch (error) {
      setSaveState("error");
      throw error;
    }
  }
  async function switchWorkspace(target?: WorkingDraft, stored?: StoredDraft) {
    if (
      !hydrated ||
      actionLock.current ||
      revisionLock.current ||
      activeGenerationStages.has(useWorkflowStore.getState().stage)
    )
      return;
    if (
      !target &&
      !stored &&
      !latestSnapshot.current.sourceText &&
      !latestSnapshot.current.sourceUrl &&
      !latestSnapshot.current.workflow.editorText &&
      !latestSnapshot.current.workflow.finalDraft
    ) {
      setView("write");
      return;
    }
    actionLock.current = true;
    setActionBusy(true);
    setSwitching(true);
    try {
      await flushWorkspace();
      let next: WorkingDraft;
      if (target) {
        const fresh = await db.workingDrafts.get(target.id);
        if (!fresh)
          throw new Error("이 작업이 삭제되었습니다. 보관함을 새로고침하세요.");
        next = { ...fresh, snapshot: validateWorkspace(fresh.snapshot) };
        await db.settings.put({ key: ACTIVE_WORK_KEY, value: next.id });
      } else {
        let value = freshWorkspace(latestSnapshot.current);
        if (stored) {
          const r = stored.request;
          value = {
            ...value,
            ...(r
              ? {
                  purpose: r.purpose,
                  sourceUrl: r.source.url ?? "",
                  sourceText: r.source.text,
                  persona: r.persona,
                  mode: r.mode,
                  variationStrength: r.variationStrength,
                  candidateCount: r.candidateCount,
                  evidence: r.userEvidence.join("\n"),
                }
              : {}),
            activeRequest: r ?? null,
            selectedCandidateId: stored.finalDraft.selectedCandidateId,
            workflow: {
              ...value.workflow,
              source: r?.source ?? null,
              generationId: stored.generationId,
              stage: "COMPLETED",
              candidates: stored.candidates,
              finalDraft: stored.finalDraft,
              editorText: stored.text,
            },
          };
        }
        next = await db.saveWorkingDraft(crypto.randomUUID(), value, 0);
      }
      session.current = new DraftSession(db, next.id, next.revision);
      setWorkId(next.id);
      restoreWorkspace({ ...next.snapshot, view: "write" });
      setVersionDiff(null);
      setNotice(
        target || stored
          ? "작업을 복원했습니다."
          : "이전 작업은 보관함에 남겼습니다. 새 글을 시작하세요.",
      );
      await refreshLibrary();
    } catch (error) {
      setNotice(
        readableError(
          error,
          "작업을 전환하지 못했습니다. 현재 입력은 유지했습니다.",
        ),
      );
    } finally {
      actionLock.current = false;
      setActionBusy(false);
      setSwitching(false);
    }
  }

  const libraryEntries = useMemo(() => {
    const works = workingDrafts.filter((w) => w.id !== workId);
    if (workId && hydrated) works.push({ id: workId, revision: 0, snapshot });
    return queryLibrary(works, drafts, librarySearch, libraryStatus);
  }, [
    workingDrafts,
    workId,
    hydrated,
    snapshot,
    drafts,
    librarySearch,
    libraryStatus,
  ]);
  const libraryPages = Math.max(1, Math.ceil(libraryEntries.length / 20));
  const currentLibraryPage = Math.min(libraryPage, libraryPages);
  const visibleLibrary = libraryEntries.slice(
    (currentLibraryPage - 1) * 20,
    currentLibraryPage * 20,
  );
  const workBusy =
    !hydrated ||
    actionBusy ||
    revisionBusy ||
    activeGenerationStages.has(workflow.stage);

  const liveFlags = useMemo<RiskFlag[]>(() => {
    if (!workflow.editorText.trim()) return [];
    if (!activeRequest) {
      const saved = workflow.finalDraft?.riskFlags ?? [];
      if (
        workflow.finalDraft &&
        workflow.editorText !== workflow.finalDraft.text
      ) {
        return [
          ...saved,
          {
            code: "INVALID_OUTPUT",
            severity: "blocking",
            message:
              "이 Draft의 원본 검수 기준을 복구할 수 없어 변경본을 승인할 수 없습니다.",
            evidence:
              "새 파이프라인에서 다시 생성하면 검수 기준이 함께 저장됩니다.",
            requiresReview: true,
          },
        ];
      }
      return saved;
    }
    return deterministicFlags(activeRequest, workflow.editorText);
  }, [activeRequest, workflow.editorText, workflow.finalDraft]);
  const blocking = liveFlags.some((flag) => flag.severity === "blocking");
  const editorDiff = useMemo(
    () =>
      workflow.finalDraft
        ? diffWords(workflow.finalDraft.text, workflow.editorText)
        : [],
    [workflow.finalDraft, workflow.editorText],
  );
  const riskSentences = useMemo(
    () => findRiskSentences(workflow.editorText, liveFlags),
    [workflow.editorText, liveFlags],
  );

  async function connect() {
    if (!validBootstrapSecret(bootstrapSecret))
      return setNotice(
        "Companion key 파일의 경로가 아니라 파일 안의 32자 이상 키를 입력하세요.",
      );
    setConnectionBusy(true);
    try {
      await persistBootstrapSecret();
      if (!(await ensureGatewayPermission())) return;
      const result = await auth.refetch();
      setNotice(
        result.data?.authenticated
          ? "Codex 구독 연결을 확인했습니다."
          : "Companion은 연결됐지만 Codex 로그인이 필요합니다.",
      );
    } catch (error) {
      setNotice(readableError(error, "Companion 연결에 실패했습니다."));
    } finally {
      setConnectionBusy(false);
    }
  }

  async function login() {
    if (!validBootstrapSecret(bootstrapSecret))
      return setNotice(
        "Companion key 파일의 경로가 아니라 파일 안의 32자 이상 키를 입력하세요.",
      );
    setConnectionBusy(true);
    try {
      await persistBootstrapSecret();
      if (!(await ensureGatewayPermission())) return;
      const result = (await gateway.login("chatgpt")) as { authUrl?: string };
      if (result.authUrl) {
        const opened = await runtime.openExternal(result.authUrl);
        setPendingAuthUrl(opened ? null : result.authUrl);
      }
      setNotice(
        "브라우저에서 ChatGPT 로그인을 완료한 뒤 연결 상태를 다시 확인하세요.",
      );
    } catch (error) {
      setNotice(readableError(error, "Codex 로그인을 시작하지 못했습니다."));
    } finally {
      setConnectionBusy(false);
    }
  }

  async function logout() {
    setConnectionBusy(true);
    try {
      await gateway.logout();
      await auth.refetch();
      setPendingAuthUrl(null);
      setNotice("Codex에서 로그아웃했습니다.");
    } catch (error) {
      setNotice(readableError(error, "로그아웃에 실패했습니다."));
    } finally {
      setConnectionBusy(false);
    }
  }

  async function captureForWorkspace() {
    if (
      !hydrated ||
      actionLock.current ||
      revisionLock.current ||
      activeGenerationStages.has(useWorkflowStore.getState().stage)
    )
      return;
    actionLock.current = true;
    setActionBusy(true);
    try {
      await captureCurrent();
    } catch (error) {
      setNotice(readableError(error, "캡처하지 못했습니다."));
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  async function captureCurrent(
    showFailureNotice = true,
  ): Promise<SourceSnapshot | null> {
    if (!hasExtensionRuntime) {
      if (showFailureNotice)
        setNotice(
          "Extension에서 Threads 탭을 열면 게시물 캡처를 사용할 수 있습니다.",
        );
      return null;
    }
    const source = await runtime.captureCurrent();
    if (!source) {
      if (showFailureNotice)
        setNotice(
          "현재 탭에서 Threads 게시물을 찾지 못했습니다. 내용을 직접 입력해 주세요.",
        );
      return null;
    }
    workflow.setSource(source);
    setSourceText(source.text);
    setSourceUrl(source.url ?? "");
    await db.sources.put(source);
    if (showFailureNotice)
      setNotice("현재 Threads 게시물을 입력에 가져왔습니다.");
    return source;
  }

  async function generate() {
    if (
      !hydrated ||
      actionLock.current ||
      revisionLock.current ||
      activeGenerationStages.has(useWorkflowStore.getState().stage)
    )
      return;
    actionLock.current = true;
    setActionBusy(true);
    try {
      let source: SourceSnapshot;
      const inputText = sourceText.trim();

      if (!inputText) {
        const captured = await captureCurrent(false);
        if (!captured)
          return setNotice(
            "작성 요청을 입력하거나, 게시물이 보이는 Threads 탭에서 다시 실행해 주세요.",
          );
        source = captured;
      } else {
        const normalizedSourceUrl = normalizeOptionalUrl(sourceUrl);
        if (sourceUrl.trim() && !normalizedSourceUrl)
          return setNotice("참고 URL 형식이 올바르지 않습니다.");
        source =
          workflow.source?.text === inputText &&
          workflow.source.url === normalizedSourceUrl
            ? workflow.source
            : {
                id: crypto.randomUUID(),
                text: inputText,
                author: null,
                url: normalizedSourceUrl,
                capturedAt: new Date().toISOString(),
                captureMethod: "paste",
                adapterVersion: "threads-web-v1",
              };
      }
      const parsed = GenerationRequestSchema.safeParse({
        source,
        persona,
        purpose,
        mode,
        variationStrength,
        candidateCount,
        userEvidence: evidence
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        affiliateDisclosure:
          mode === "affiliate"
            ? "이 글에는 제휴 링크가 포함될 수 있습니다."
            : null,
      });
      if (!parsed.success)
        return setNotice(validationMessage(parsed.error.issues[0]));
      const request = parsed.data;
      setNotice(null);
      let generationId: string | null = null;
      try {
        await db.personas.put(persona);
        await db.sources.put(source);
        workflow.setSource(source);
        const { id } = await gateway.createGeneration(request);
        generationId = id;
        setActiveRequest(request);
        setSelectedCandidateId(null);
        workflow.begin(id);
        await db.generations.put({
          id,
          state: "QUEUED",
          promptVersion: null,
          rubricVersion: null,
          startedAt: new Date().toISOString(),
          completedAt: null,
        });
        await consumeGenerationEvents(id);
      } catch (error) {
        const message = readableError(error, "생성 요청에 실패했습니다.");
        if (generationId) workflow.fail(message);
        setNotice(message);
      }
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  async function cancel() {
    if (!workflow.generationId) return;
    try {
      await gateway.cancelGeneration(workflow.generationId);
      workflow.cancelLocal();
      setNotice("생성 작업을 취소했습니다.");
    } catch (error) {
      setNotice(readableError(error, "생성 작업을 취소하지 못했습니다."));
    }
  }

  function chooseCandidate(id: string) {
    const candidate = workflow.candidates.find((item) => item.id === id);
    if (!candidate) return;
    setSelectedCandidateId(id);
    workflow.edit(candidate.text);
  }

  async function approveAndSave() {
    if (
      actionLock.current ||
      revisionLock.current ||
      !workflow.finalDraft ||
      blocking ||
      countThreadsTextUnits(workflow.editorText) > 500
    )
      return;
    if (!workflow.editorText.trim())
      return setNotice("빈 글은 승인 저장할 수 없습니다.");
    if (
      workflow.finalDraft.approvalStatus === "APPROVED" &&
      workflow.finalDraft.text === workflow.editorText
    )
      return setNotice("현재 편집본은 이미 승인 저장되었습니다.");
    actionLock.current = true;
    setActionBusy(true);
    try {
      const now = new Date().toISOString();
      const approved = FinalDraftSchema.parse({
        ...workflow.finalDraft,
        selectedCandidateId:
          selectedCandidateId ?? workflow.finalDraft.selectedCandidateId,
        text: workflow.editorText,
        riskFlags: liveFlags,
        approvalStatus: "APPROVED",
        approvedAt: now,
      });
      const versions = await db.drafts
        .where("id")
        .equals(approved.id)
        .toArray();
      const current = versions.reduce(
        (max, item) => Math.max(max, item.version),
        0,
      );
      await db.saveDraftVersion(
        {
          id: approved.id,
          generationId: approved.generationId,
          text: approved.text,
          finalDraft: approved,
          candidates: workflow.candidates,
          request: activeRequest,
          createdAt: approved.createdAt,
          updatedAt: now,
        },
        current,
      );
      if (workflow.finalDraft.text !== approved.text) {
        await db.edits.add({
          id: crypto.randomUUID(),
          draftId: approved.id,
          beforeText: workflow.finalDraft.text,
          afterText: approved.text,
          createdAt: now,
        });
      }
      const currentState = useWorkflowStore.getState();
      if (
        currentState.generationId === approved.generationId &&
        currentState.editorText === approved.text
      ) {
        workflow.approve(approved);
        setNotice("최종 승인 Snapshot을 로컬에 저장했습니다.");
      } else {
        setNotice(
          "요청 시점의 승인본을 저장했습니다. 이후 편집한 본문은 보존했으며 다시 승인해야 합니다.",
        );
      }
      await refreshLibrary();
    } catch (error) {
      setNotice(readableError(error, "Draft를 저장하지 못했습니다."));
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  async function handoff() {
    if (
      actionLock.current ||
      revisionLock.current ||
      !workflow.finalDraft ||
      blocking ||
      countThreadsTextUnits(workflow.editorText) > 500
    )
      return;
    if (
      workflow.finalDraft.approvalStatus !== "APPROVED" ||
      workflow.finalDraft.text !== workflow.editorText
    ) {
      return setNotice("현재 편집본을 최종 승인 저장한 뒤 전달하세요.");
    }
    actionLock.current = true;
    setActionBusy(true);
    try {
      try {
        await navigator.clipboard.writeText(workflow.editorText);
      } catch {
        return setNotice(
          "클립보드에 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.",
        );
      }
      let result: ComposerHandoffResult;
      try {
        result = await runtime.openComposer(workflow.editorText);
      } catch {
        return setNotice(
          "Threads 작성창을 열지 못했습니다. 초안은 클립보드에 보존했습니다.",
        );
      }
      if (result.status === "filled") {
        setNotice(
          "로그인된 Threads 작성창에 초안을 입력했습니다. 게시·예약 확정은 직접 진행하세요.",
        );
      } else if (result.status === "login-required") {
        setNotice(
          "Threads 웹 로그인이 필요합니다. 로그인 후 클립보드의 초안을 직접 붙여넣으세요.",
        );
      } else if (result.status === "opened") {
        setNotice(
          "초안을 클립보드에 복사하고 Threads를 열었습니다. 작성창에 붙여넣은 뒤 게시 내용을 확인하세요.",
        );
      } else {
        setNotice(
          "Threads 로그인 상태 또는 작성창 구조를 확인하지 못했습니다. 초안은 클립보드에 보존했습니다.",
        );
      }
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }

  async function saveSecret() {
    if (!validBootstrapSecret(bootstrapSecret))
      return setNotice(
        "Companion key 파일의 경로가 아니라 파일 안의 32자 이상 키를 입력하세요.",
      );
    try {
      await persistBootstrapSecret();
      setNotice("연결 키를 로컬에 저장했습니다. Export에는 포함되지 않습니다.");
    } catch (error) {
      setNotice(readableError(error, "연결 키를 저장하지 못했습니다."));
    }
  }

  async function exportData() {
    try {
      if (hydrated) {
        try {
          await flushWorkspace();
        } catch {
          setNotice(
            "저장하지 못한 현재 입력도 currentRecovery 항목으로 내보냈습니다.",
          );
        }
      }
      const blob = new Blob(
        [
          JSON.stringify(
            {
              ...(await db.exportAll()),
              currentRecovery: hydrated
                ? [
                    {
                      id: session.current?.id,
                      snapshot: latestSnapshot.current,
                    },
                  ]
                : [],
              appearance: [appearance.getSnapshot().mode],
            },
            null,
            2,
          ),
        ],
        {
          type: "application/json",
        },
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `threadflow-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(
        readableError(
          error,
          "내보내기에 실패했습니다. 본문을 직접 복사해 보관하세요.",
        ),
      );
    }
  }

  async function deleteAll() {
    if (
      actionLock.current ||
      revisionLock.current ||
      activeGenerationStages.has(useWorkflowStore.getState().stage)
    )
      return setNotice("진행 중인 작업을 마친 뒤 삭제하세요.");
    if (
      !window.confirm(
        "Persona, Source, Draft, 캘린더와 설정을 모두 삭제할까요?",
      )
    )
      return;
    actionLock.current = true;
    setActionBusy(true);
    deletingData.current = true;
    window.clearTimeout(saveTimer.current);
    await session.current?.drain();
    try {
      setHydrated(false);
      await db.deleteAllUserData();
      session.current = new DraftSession(db, crypto.randomUUID());
      setWorkId(session.current.id);
      setWorkingDrafts([]);
      const themeReset = appearance.reset();
      workflow.clear();
      setView("write");
      setPurpose(defaultPurpose);
      setSourceUrl("");
      setMode("new");
      setVariationStrength(0.8);
      setCandidateCount(4);
      setEvidence("");
      setSourceText("");
      setPersona(cloneDefaultPersona());
      setActiveRequest(null);
      setSelectedCandidateId(null);
      setDrafts([]);
      setSlots([]);
      setPublicationLinks([]);
      setVersionDiff(null);
      setImage(null);
      setBootstrapSecret("");
      gateway.resetSession();
      setNotice(
        themeReset
          ? "로컬 데이터를 모두 삭제했습니다."
          : "작성 데이터는 삭제했지만 테마 설정을 지우지 못했습니다.",
      );
    } catch (error) {
      setNotice(
        readableError(
          error,
          "삭제에 실패했습니다. 기존 데이터는 보존했습니다.",
        ),
      );
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
    window.setTimeout(() => {
      deletingData.current = false;
      setHydrated(true);
    }, 0);
  }

  async function refreshLibrary() {
    setDrafts(await db.drafts.orderBy("updatedAt").reverse().toArray());
    setWorkingDrafts(await db.workingDrafts.toArray());
    setSlots(await db.calendarSlots.orderBy("scheduledAt").toArray());
    setPublicationLinks(await db.publicationLinks.toArray());
  }

  function restoreWorkspace(workspace: WorkspaceSnapshot) {
    setImage(workspace.image ?? null);
    setView(workspace.view);
    setPurpose(workspace.purpose);
    setSourceUrl(workspace.sourceUrl);
    setSourceText(workspace.sourceText);
    setMode(workspace.mode);
    setVariationStrength(workspace.variationStrength);
    setCandidateCount(workspace.candidateCount);
    setEvidence(workspace.evidence);
    setPersona(workspace.persona);
    setActiveRequest(workspace.activeRequest);
    setSelectedCandidateId(workspace.selectedCandidateId);
    workflow.restore(workspace.workflow);
  }

  function loadStoredDraft(draft: StoredDraft) {
    void switchWorkspace(undefined, draft);
  }

  async function consumeGenerationEvents(id: string): Promise<void> {
    const owner = session.current?.id;
    for await (const event of gateway.events(id)) {
      if (
        session.current?.id !== owner ||
        useWorkflowStore.getState().generationId !== id ||
        deletingData.current
      )
        return;
      if (useWorkflowStore.getState().stage === "CANCELED") return;
      workflow.applyEvent(event);
      if (event.type === "result") {
        setSelectedCandidateId(event.finalDraft.selectedCandidateId);
        setNotice(
          "1턴 생성이 완료되었습니다. 완성된 글을 확인한 뒤 승인해 주세요.",
        );
        window.setTimeout(() => {
          if (
            !hasExtensionRuntime &&
            window.matchMedia("(min-width: 960px)").matches
          )
            return;
          resultRef.current?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
            block: "start",
          });
        }, 0);
      }
      const previous = await db.generations.get(id);
      await db.generations.put({
        id,
        state:
          event.type === "state"
            ? event.state
            : event.type === "error"
              ? "FAILED"
              : (previous?.state ?? "QUEUED"),
        promptVersion:
          event.type === "result"
            ? event.finalDraft.promptVersion
            : (previous?.promptVersion ?? null),
        rubricVersion:
          event.type === "result"
            ? event.finalDraft.rubricVersion
            : (previous?.rubricVersion ?? null),
        startedAt: previous?.startedAt ?? new Date().toISOString(),
        completedAt:
          event.type === "state" &&
          ["COMPLETED", "FAILED", "CANCELED"].includes(event.state)
            ? event.at
            : (previous?.completedAt ?? null),
      });
    }
  }

  async function persistBootstrapSecret(): Promise<void> {
    await db.settings.put({
      key: "bootstrapSecret",
      value: bootstrapSecret.trim(),
    });
    gateway.resetSession();
  }

  async function ensureGatewayPermission(): Promise<boolean> {
    const granted = await runtime.requestGatewayPermission();
    if (!granted) setNotice("localhost Companion 접근 권한이 필요합니다.");
    return granted;
  }

  async function linkPublishedResult(draftId: string) {
    const raw = window.prompt("실제 게시된 Threads URL을 입력하세요.");
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return setNotice("올바른 URL을 입력하세요.");
    }
    if (
      url.protocol !== "https:" ||
      !(url.hostname === "threads.com" || url.hostname.endsWith(".threads.com"))
    ) {
      return setNotice("threads.com의 HTTPS 게시물 URL만 연결할 수 있습니다.");
    }
    await db.publicationLinks.put({
      draftId,
      url: url.toString(),
      linkedAt: new Date().toISOString(),
    });
    await refreshLibrary();
    setNotice("Draft와 실제 게시 결과를 연결했습니다.");
  }

  function comparePrevious(draft: StoredDraft) {
    const previous = drafts.find(
      (item) => item.id === draft.id && item.version === draft.version - 1,
    );
    if (!previous) return setNotice("비교할 이전 Draft 버전이 없습니다.");
    setVersionDiff({
      from: previous.version,
      to: draft.version,
      chunks: diffWords(previous.text, draft.text),
    });
  }

  async function addCalendarSlot() {
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    await db.calendarSlots.add({
      id: crypto.randomUUID(),
      title: purpose.slice(0, 80),
      scheduledAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      draftId: workflow.finalDraft?.id ?? null,
      status: workflow.finalDraft ? "ready" : "idea",
    });
    await refreshLibrary();
  }

  function handleImage(file?: File) {
    if (!file) return setImage(null);
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setNotice("이미지는 10MB 이하의 이미지 파일만 선택할 수 있습니다.");
      return;
    }
    setImage({
      name: file.name,
      size: file.size,
      altText: file.name.replace(/[-_]/g, " ").replace(/\.[^.]+$/, ""),
    });
  }

  return (
    <main className={`shell shell-${runtime.kind}`}>
      <a className="skip-link" href="#workspace">
        작업 영역으로 건너뛰기
      </a>
      <header className="topbar">
        <div>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              t.
            </span>
            <span>
              ThreadFlow<b>OS</b>
            </span>
          </div>
        </div>
        <div className="topbar-state">
          <ThemeControl compact />
          <span className={`save-status ${saveState}`} role="status">
            {saveState === "saved"
              ? "이 브라우저에 자동 보관됨"
              : saveState === "saving"
                ? "자동 보관 중…"
                : saveState === "error"
                  ? "로컬 보관 오류 · 설정에서 내보내기"
                  : "작업 불러오는 중…"}
          </span>
          <button
            className={`status ${auth.data?.authenticated && !auth.isError ? "online" : ""}`}
            onClick={() => setView("settings")}
          >
            <i aria-hidden="true" />
            {auth.isFetching
              ? "연결 확인 중"
              : auth.data?.authenticated && !auth.isError
                ? "Codex 연결됨"
                : "Codex 연결 설정"}
          </button>
        </div>
      </header>
      <aside className="navigation">
        <p className="nav-label">WORKSPACE</p>
        <nav className="tabs" aria-label="주요 화면">
          {(
            [
              ["write", "작성", "write"],
              ["library", "보관함", "library"],
              ["calendar", "캘린더", "calendar"],
              ["settings", "설정", "settings"],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              aria-current={view === id ? "page" : undefined}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                if (id === "library")
                  void refreshLibrary().catch(() =>
                    setNotice("보관함을 읽지 못했습니다."),
                  );
              }}
              key={id}
            >
              <UiIcon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <span className="eyebrow">LOCAL WORKSPACE</span>
          <p>
            글은 이 브라우저에.
            <br />
            게시 결정은 내 손에.
          </p>
        </div>
      </aside>
      <div className="workspace-content" id="workspace" tabIndex={-1}>
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {view === "write"
                ? "WRITING STUDIO"
                : view === "library"
                  ? "YOUR DRAFTS"
                  : view === "calendar"
                    ? "CONTENT PLAN"
                    : "PREFERENCES"}
            </span>
            <h1>
              {view === "write"
                ? "글쓰기 스튜디오"
                : view === "library"
                  ? "보관함"
                  : view === "calendar"
                    ? "캘린더"
                    : "설정"}
            </h1>
            <p>
              {view === "write"
                ? "아이디어를 글로, 마지막 다듬기는 나답게."
                : view === "library"
                  ? "작성 중인 메모부터 승인한 글까지 다시 이어 쓰세요."
                  : view === "calendar"
                    ? "다음에 쓸 주제를 모아 두세요. 자동 게시 일정은 아닙니다."
                    : "Codex 연결과 이 브라우저의 데이터를 관리하세요."}
            </p>
          </div>
          {view === "write" && (
            <button
              className="new-work"
              disabled={
                !hydrated ||
                actionBusy ||
                revisionBusy ||
                activeGenerationStages.has(workflow.stage)
              }
              onClick={() => void switchWorkspace()}
            >
              + 새 작업
            </button>
          )}
        </div>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button aria-label="알림 닫기" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        )}

        {view === "write" && (
          <fieldset className="writer-layout" disabled={switching || !hydrated}>
            <section
              className="card one-turn-card"
              aria-labelledby="brief-title"
            >
              <div className="section-title">
                <span>01</span>
                <h2 id="brief-title">작성 요청</h2>
                {hasExtensionRuntime && (
                  <button
                    className="text-button"
                    disabled={!hasExtensionRuntime}
                    onClick={() => void captureForWorkspace()}
                  >
                    <UiIcon name="capture" />
                    <span>
                      {hasExtensionRuntime
                        ? "현재 글 가져오기"
                        : "확장 설치 후 캡처"}
                    </span>
                  </button>
                )}
              </div>
              <p className="one-turn-lead">
                주제나 메모를 넣어 주세요.
                <br />
                여러 후보를 비교해 초안을 제안합니다.
              </p>
              <textarea
                className="source-input"
                aria-label="주제·메모·참고 글"
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                placeholder={
                  hasExtensionRuntime
                    ? "어떤 글을 만들까요?\n예: AI 자동화가 필요한 이유를 실무자 관점에서 써줘\n\n비워 두면 현재 Threads 게시물을 자동으로 가져옵니다."
                    : "어떤 글을 만들까요?\n예: AI 자동화가 필요한 이유를 실무자 관점에서 써줘\n\n웹에서는 주제·메모·참고 글을 직접 입력하세요."
                }
                rows={7}
              />
              <div className="source-meta">
                <span>{workflow.source?.author ?? "직접 입력"}</span>
                <span>{sourceText.length.toLocaleString()}자</span>
              </div>
              <p className="field-caption">어떻게 쓸까요?</p>
              <div className="quick-modes" aria-label="작성 모드">
                {(
                  [
                    ["new", "새 글"],
                    ["polish", "다듬기"],
                    ["shorten", "짧게"],
                    ["alternate-angle", "다른 관점"],
                    ["affiliate", "제휴 글"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    className={mode === value ? "active" : ""}
                    aria-pressed={mode === value}
                    key={value}
                    onClick={() => setMode(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <details className="advanced-settings">
                <summary>
                  문체·근거 설정 <small>선택 사항</small>
                </summary>
                <div className="advanced-settings-body">
                  <label>
                    작성 목적
                    <input
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                    />
                  </label>
                  <label>
                    참고 URL <small>선택 사항</small>
                    <span className="control-with-icon">
                      <UiIcon name="link" />
                      <input
                        type="url"
                        value={sourceUrl}
                        onChange={(event) => setSourceUrl(event.target.value)}
                        placeholder="https://www.threads.com/@user/post/..."
                      />
                    </span>
                  </label>
                  <div className="grid2">
                    <label>
                      후보 수
                      <select
                        value={candidateCount}
                        onChange={(event) =>
                          setCandidateCount(Number(event.target.value))
                        }
                      >
                        <option>3</option>
                        <option>4</option>
                        <option>5</option>
                      </select>
                    </label>
                    <label>
                      변형 강도 {Math.round(variationStrength * 100)}%
                      <span className="range-control">
                        <UiIcon name="intensity" />
                        <input
                          aria-label="변형 강도"
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={variationStrength}
                          onChange={(event) =>
                            setVariationStrength(Number(event.target.value))
                          }
                        />
                      </span>
                    </label>
                  </div>
                  <label>
                    독자
                    <span className="control-with-icon">
                      <UiIcon name="audience" />
                      <input
                        value={persona.audience}
                        onChange={(event) =>
                          setPersona({
                            ...persona,
                            audience: event.target.value,
                          })
                        }
                      />
                    </span>
                  </label>
                  <label>
                    Persona 문체
                    <span className="control-with-icon">
                      <UiIcon name="voice" />
                      <input
                        value={persona.voice}
                        onChange={(event) =>
                          setPersona({ ...persona, voice: event.target.value })
                        }
                      />
                    </span>
                  </label>
                  <label>
                    확인된 근거 <small>한 줄에 하나</small>
                    <span className="control-with-icon control-with-icon-textarea">
                      <UiIcon name="evidence" />
                      <textarea
                        value={evidence}
                        onChange={(event) => setEvidence(event.target.value)}
                        rows={3}
                        placeholder="가격·날짜·수치가 있다면 출처가 확인된 문장만 입력"
                      />
                    </span>
                  </label>
                </div>
              </details>
              <button
                className="primary one-turn-submit"
                disabled={
                  !hydrated ||
                  revisionBusy ||
                  actionBusy ||
                  (!sourceText.trim() && !hasExtensionRuntime) ||
                  !["IDLE", "COMPLETED", "FAILED", "CANCELED"].includes(
                    workflow.stage,
                  )
                }
                onClick={generate}
              >
                <UiIcon name="sparkle" />
                <span>
                  {activeGenerationStages.has(workflow.stage)
                    ? "초안 작성 중…"
                    : "1턴으로 완성하기"}
                </span>
              </button>
              <p className="one-turn-footnote">
                {hasExtensionRuntime
                  ? "입력이 비어 있으면 현재 보고 있는 Threads 글을 자동으로 가져옵니다. "
                  : "분석 → 후보 비교 → 개선 → 위험 검수. "}
                게시 전 최종 승인은 직접 합니다.
              </p>
            </section>

            <div className="result-column">
              {workflow.stage !== "IDLE" && (
                <section
                  className={`progress card ${workflow.stage.toLowerCase()}`}
                  aria-label="생성 진행 상태"
                >
                  <div className="progress-copy" role="status">
                    <span
                      className={`stage-dot ${activeGenerationStages.has(workflow.stage) ? "running" : ""}`}
                      aria-hidden="true"
                    />
                    <b>{stages[workflow.stage] ?? workflow.stage}</b>
                    <span>
                      {activeGenerationStages.has(workflow.stage)
                        ? "Codex가 작업하고 있습니다"
                        : workflow.stage === "COMPLETED"
                          ? "초안을 직접 검토해 주세요"
                          : "입력은 보존되어 있습니다"}
                    </span>
                  </div>
                  {activeGenerationStages.has(workflow.stage) && (
                    <button className="secondary" onClick={cancel}>
                      생성 취소
                    </button>
                  )}
                  {workflow.error && (
                    <p className="safety-note" role="alert">
                      {workflow.error}
                    </p>
                  )}
                </section>
              )}
              {!workflow.finalDraft && (
                <section
                  className="card editor-empty"
                  aria-label="편집 결과 대기"
                >
                  <div className="section-title">
                    <span>02</span>
                    <h2>완성된 글</h2>
                    <em>편집 공간</em>
                  </div>
                  <div className="empty-canvas">
                    <div className="paper-symbol" aria-hidden="true">
                      <UiIcon name="write" />
                    </div>
                    <h3>
                      {activeGenerationStages.has(workflow.stage)
                        ? "당신의 아이디어를 다듬고 있어요"
                        : "첫 문장의 시작은, 작은 메모 하나"}
                    </h3>
                    <p>
                      {activeGenerationStages.has(workflow.stage)
                        ? "작성이 끝나면 이곳에서 초안을 읽고 수정할 수 있습니다."
                        : "작성 요청을 입력하면 이곳에 초안이 나타납니다.\n읽고, 다듬고, 승인한 뒤 Threads로 가져가세요."}
                    </p>
                  </div>
                  <p className="canvas-note">
                    자동으로 게시하지 않습니다. 최종 결정은 직접 합니다.
                  </p>
                </section>
              )}
              {workflow.finalDraft && (
                <section className="card editor-card" ref={resultRef}>
                  <div className="section-title">
                    <span>02</span>
                    <h2>완성된 글</h2>
                    <em
                      className={
                        countThreadsTextUnits(workflow.editorText) > 500
                          ? "over-limit"
                          : ""
                      }
                    >
                      {countThreadsTextUnits(workflow.editorText)} / 500자
                    </em>
                  </div>
                  <div className="editor-tools">
                    <button
                      onClick={workflow.undo}
                      disabled={!workflow.history.length}
                    >
                      되돌리기
                    </button>
                    <button
                      onClick={workflow.redo}
                      disabled={!workflow.future.length}
                    >
                      다시 실행
                    </button>
                    <span>
                      AI 초안 대비{" "}
                      {Math.abs(
                        workflow.editorText.length -
                          workflow.finalDraft.text.length,
                      )}
                      자 변화
                    </span>
                  </div>
                  <RevisionPanel
                    key={workId + workflow.generationId}
                    contextKey={workId + (workflow.generationId ?? "")}
                    disabled={
                      actionBusy || activeGenerationStages.has(workflow.stage)
                    }
                    text={workflow.editorText}
                    request={(scope, feedback, baseText) =>
                      gateway.reviseGeneration(
                        workflow.generationId!,
                        scope,
                        feedback,
                        baseText,
                      )
                    }
                    onApply={workflow.edit}
                    onBusy={(busy) => {
                      revisionLock.current = busy;
                      setRevisionBusy(busy);
                    }}
                  />
                  <textarea
                    className="editor"
                    aria-label="완성된 글 편집"
                    value={workflow.editorText}
                    onChange={(event) => workflow.edit(event.target.value)}
                    rows={10}
                  />
                  {editorDiff.some((chunk) => chunk.type !== "equal") && (
                    <details
                      className="version-diff"
                      aria-label="AI 초안 대비 변경점"
                    >
                      <summary>AI 초안 대비 변경점</summary>
                      <p>
                        {editorDiff.map((chunk, index) => (
                          <span
                            className={chunk.type}
                            key={`${chunk.type}-${index}`}
                          >
                            {chunk.value}
                          </span>
                        ))}
                      </p>
                    </details>
                  )}
                  <div className="risk-list">
                    {liveFlags.length ? (
                      liveFlags.map((flag, index) => (
                        <div
                          key={`${flag.code}-${index}`}
                          className={`risk ${flag.severity}`}
                        >
                          <b>
                            {flag.severity === "blocking"
                              ? "확인 필요"
                              : "참고"}
                          </b>
                          <span>{flag.message}</span>
                          <small>{flag.evidence}</small>
                        </div>
                      ))
                    ) : (
                      <div className="safe">
                        <b>자동 검사에서 위험 표현 미검출</b>
                        <span>사실·문맥·문장 품질은 직접 확인해 주세요.</span>
                      </div>
                    )}
                  </div>
                  {riskSentences.length > 0 && (
                    <div className="risk-sentences">
                      <b>위험 표현이 포함된 문장</b>
                      {riskSentences.map((sentence) => (
                        <mark key={sentence}>{sentence}</mark>
                      ))}
                    </div>
                  )}
                  <details className="attachment-details">
                    <summary>
                      이미지 첨부 준비 <small>선택 사항</small>
                    </summary>
                    <label className="file-field">
                      이미지 선택{" "}
                      <small>
                        파일은 전송되지 않습니다. Threads에서 직접 첨부하세요.
                      </small>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          handleImage(event.target.files?.[0])
                        }
                      />
                    </label>
                    {image && (
                      <label>
                        Alt Text 초안
                        <input
                          value={image.altText}
                          onChange={(event) =>
                            setImage({ ...image, altText: event.target.value })
                          }
                        />
                        <small>
                          {Math.round(image.size / 1024)}KB · 실제 이미지는 외부
                          전송하지 않습니다.
                        </small>
                      </label>
                    )}
                  </details>
                  <EditorActions
                    text={workflow.editorText}
                    approved={
                      workflow.finalDraft.approvalStatus === "APPROVED" &&
                      workflow.finalDraft.text === workflow.editorText
                    }
                    blocking={blocking}
                    warningCount={liveFlags.length}
                    busy={actionBusy || revisionBusy}
                    extension={hasExtensionRuntime}
                    onApprove={approveAndSave}
                    onHandoff={handoff}
                  />
                </section>
              )}
              {workflow.candidates.length > 0 && (
                <details className="card candidate-review">
                  <summary>
                    비교한 후보 {workflow.candidates.length}개 보기
                    <small>AI 점수는 참고용</small>
                  </summary>
                  <div className="candidates">
                    {workflow.candidates.map((candidate, index) => (
                      <button
                        key={candidate.id}
                        onClick={() => chooseCandidate(candidate.id)}
                        aria-pressed={selectedCandidateId === candidate.id}
                        className={`candidate ${selectedCandidateId === candidate.id ? "selected" : ""}`}
                      >
                        <div>
                          <b>{String(index + 1).padStart(2, "0")}</b>
                          <span>{candidate.angle}</span>
                          <strong>
                            {Math.round(candidate.score?.total ?? 0)}
                          </strong>
                        </div>
                        <p>{candidate.hook}</p>
                        <small>{candidate.rationale}</small>
                        {candidate.riskFlags.length > 0 && (
                          <div className="candidate-risks">
                            {candidate.riskFlags.map((flag) => (
                              <span key={flag.code}>{flag.code}</span>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </fieldset>
        )}

        {view === "library" && (
          <section className="card">
            <div className="section-title">
              <span>LIB</span>
              <h2>내 글과 작업</h2>
              <button className="text-button" onClick={refreshLibrary}>
                새로고침
              </button>
            </div>
            <div className="library-search">
              <label>
                글 검색
                <input
                  type="search"
                  value={librarySearch}
                  placeholder="본문·메모·근거 검색"
                  onChange={(e) => {
                    setLibrarySearch(e.target.value);
                    setLibraryPage(1);
                  }}
                />
              </label>
              <label>
                작업 상태
                <select
                  value={libraryStatus}
                  onChange={(e) => {
                    setLibraryStatus(e.target.value as LibraryStatus);
                    setLibraryPage(1);
                  }}
                >
                  <option value="all">전체</option>
                  <option value="writing">작성 중</option>
                  <option value="approved">승인 완료</option>
                </select>
              </label>
            </div>
            <p className="library-count" role="status">
              총 {libraryEntries.length}개 · 임시 작업과 승인 이력 · 이
              브라우저에만 보관
            </p>
            {versionDiff && (
              <div className="version-diff" aria-label="Draft 버전 차이">
                <b>
                  v{versionDiff.from} → v{versionDiff.to}
                </b>
                <p>
                  {versionDiff.chunks.map((chunk, index) => (
                    <span className={chunk.type} key={`${chunk.type}-${index}`}>
                      {chunk.value}
                    </span>
                  ))}
                </p>
              </div>
            )}
            {visibleLibrary.length ? (
              visibleLibrary.map((entry) => {
                const draft = entry.draft;
                const publication = publicationLinks.find(
                  (p) => p.draftId === draft?.id,
                );
                return (
                  <article className="library-item" key={entry.key}>
                    <button
                      className="library-row"
                      disabled={workBusy}
                      onClick={() =>
                        entry.historical && draft
                          ? loadStoredDraft(draft)
                          : entry.work
                            ? void switchWorkspace(entry.work)
                            : draft && loadStoredDraft(draft)
                      }
                    >
                      <b
                        className={
                          entry.status === "approved" ? "approved-badge" : ""
                        }
                      >
                        {entry.status === "approved" ? "승인 완료" : "작성 중"}
                      </b>
                      <span>
                        {entry.title}
                        {entry.work?.id === workId && (
                          <small> · 현재 작업</small>
                        )}
                        {entry.historical && (
                          <small className="history-match">
                            과거 v{draft?.version} 본문에서 검색됨 · 열면 해당
                            버전 복원
                          </small>
                        )}
                      </span>
                      <time>{new Date(entry.updatedAt).toLocaleString()}</time>
                    </button>
                    {draft && (
                      <div className="library-actions">
                        <span>승인 이력 v{draft.version}</span>
                        <button
                          className="link-result"
                          disabled={draft.version < 2}
                          onClick={() => comparePrevious(draft)}
                        >
                          이전 버전 비교
                        </button>
                        {publication ? (
                          <a
                            href={publication.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            게시 결과 열기
                          </a>
                        ) : (
                          <button
                            className="link-result"
                            onClick={() => void linkPublishedResult(draft.id)}
                          >
                            게시 결과 연결
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <p className="empty">
                {librarySearch || libraryStatus !== "all"
                  ? "조건에 맞는 글이 없습니다. 검색어나 상태 필터를 바꿔 보세요."
                  : "아직 보관한 글이 없습니다. 작성 화면에서 첫 메모를 시작하세요."}
              </p>
            )}
            {libraryPages > 1 && (
              <nav className="library-pagination" aria-label="보관함 페이지">
                <button
                  disabled={currentLibraryPage <= 1}
                  onClick={() => setLibraryPage(currentLibraryPage - 1)}
                >
                  이전 페이지
                </button>
                <span>
                  {currentLibraryPage} / {libraryPages}
                </span>
                <button
                  disabled={currentLibraryPage >= libraryPages}
                  onClick={() => setLibraryPage(currentLibraryPage + 1)}
                >
                  다음 페이지
                </button>
              </nav>
            )}
          </section>
        )}

        {view === "calendar" && (
          <section className="card">
            <div className="section-title">
              <span>CAL</span>
              <h2>콘텐츠 캘린더</h2>
              <button className="text-button" onClick={addCalendarSlot}>
                내일 슬롯 추가
              </button>
            </div>
            {slots.length ? (
              slots.map((slot) => (
                <div className="calendar-row" key={slot.id}>
                  <time>{new Date(slot.scheduledAt).toLocaleString()}</time>
                  <span>{slot.title}</span>
                  <b>{slot.status}</b>
                </div>
              ))
            ) : (
              <p className="empty">아직 주제 슬롯이 없습니다.</p>
            )}
          </section>
        )}

        {view === "settings" && (
          <section className="card settings">
            <ThemeControl />
            {!hasExtensionRuntime && (
              <details className="runtime-guide">
                <summary>Chrome 확장은 언제 필요한가요?</summary>
                <p>
                  웹에서는 직접 입력하고 승인한 글을 복사합니다. 현재 Threads 글
                  캡처·작성창 자동 입력은 확장에서 사용할 수 있습니다.
                </p>
                <p>
                  <code>pnpm build</code> 후 Chrome 확장 관리의 개발자 모드에서{" "}
                  <code>apps/extension/.output/chrome-mv3</code>를 로드하세요.
                  표시된 ID로{" "}
                  <code>pnpm start:developer -- &lt;extension-id&gt;</code>를
                  실행합니다.
                </p>
                <p>
                  작성창 자동 입력에는 같은 Chrome 프로필의 Threads 로그인이
                  필요합니다. 웹과 확장의 저장 공간은 별도이며 게시 버튼은
                  자동으로 누르지 않습니다.
                </p>
              </details>
            )}
            <div className="section-title">
              <span>SET</span>
              <h2>연결과 데이터</h2>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label>
                Companion 연결 키
                <input
                  type="password"
                  autoComplete="off"
                  value={bootstrapSecret}
                  onChange={(event) => setBootstrapSecret(event.target.value)}
                  placeholder="session-secret 파일 안의 키 문자열"
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={connectionBusy}
                  onClick={saveSecret}
                >
                  키 저장
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={connectionBusy}
                >
                  {connectionBusy ? "확인 중…" : "Codex 상태 확인"}
                </button>
              </div>
            </form>
            {auth.data && (
              <div className="account-box">
                <b>{auth.data.accountType ?? "로그아웃됨"}</b>
                <span>{auth.data.planType ?? "—"}</span>
                <span>Provider {auth.data.providerVersion ?? "—"}</span>
              </div>
            )}
            {!auth.data?.authenticated ? (
              <button
                className="wide"
                disabled={connectionBusy}
                onClick={login}
              >
                ChatGPT 구독으로 로그인
              </button>
            ) : (
              <button
                className="wide"
                disabled={connectionBusy}
                onClick={logout}
              >
                로그아웃
              </button>
            )}
            {pendingAuthUrl && (
              <a
                className="auth-fallback"
                href={pendingAuthUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setPendingAuthUrl(null)}
              >
                팝업이 차단됐습니다. ChatGPT 로그인 페이지 직접 열기
              </a>
            )}
            <hr />
            <button className="wide" onClick={exportData}>
              로컬 데이터 내보내기
            </button>
            <button className="wide danger" onClick={deleteAll}>
              로컬 데이터 전체 삭제
            </button>
            <p className="safety-note">
              OAuth Access/Refresh Token은 이 화면에 저장되지 않습니다.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function normalizeOptionalUrl(value: string): string | null {
  if (!value.trim()) return null;
  try {
    return new URL(value.trim()).toString();
  } catch {
    return null;
  }
}

function cloneDefaultPersona(): Persona {
  return {
    ...defaultPersona,
    goals: [...defaultPersona.goals],
    bannedPhrases: [...defaultPersona.bannedPhrases],
    preferredLength: { ...defaultPersona.preferredLength },
  };
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function validBootstrapSecret(value: string): boolean {
  return value.trim().length >= 32;
}

function validationMessage(issue?: {
  path: PropertyKey[];
  message: string;
}): string {
  if (!issue) return "입력값을 확인하세요.";
  const field = issue.path.join(".");
  const labels: Record<string, string> = {
    "source.text": "참고 글",
    purpose: "작성 목적",
    "persona.audience": "독자",
    "persona.voice": "Persona 문체",
    userEvidence: "확인된 근거",
  };
  return `${labels[field] ?? (field || "입력값")}: ${issue.message}`;
}
