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
import { GatewayClient } from "../../lib/gateway-client.js";
import type {
  ComposerHandoffResult,
  ExtensionMessage,
} from "../../lib/messages.js";
import {
  db,
  type CalendarSlot,
  type PublicationLink,
  type StoredDraft,
  type WorkspaceState,
} from "../../storage/database.js";
import { useWorkflowStore } from "../../features/workflow-store.js";

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

const hasExtensionRuntime =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

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

export function App() {
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
  const [connectionBusy, setConnectionBusy] = useState(false);
  const deletingData = useRef(false);

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
      hasExtensionRuntime
        ? chrome.runtime.sendMessage({
            type: "GET_PENDING_CAPTURE",
          } satisfies ExtensionMessage)
        : Promise.resolve({ source: null }),
      db.personas.get("persona-default"),
      db.settings.get("bootstrapSecret"),
      db.workspaceStates.get("current"),
    ])
      .then(async ([capture, savedPersona, secret, workspace]) => {
        if (disposed) return;
        if (workspace) restoreWorkspace(workspace);
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
          workspace?.workflow.generationId &&
          activeGenerationStages.has(workspace.workflow.stage)
        ) {
          void consumeGenerationEvents(workspace.workflow.generationId).catch(
            (error) => {
              const message = readableError(
                error,
                "이전 생성 작업을 복구하지 못했습니다.",
              );
              workflow.fail(message);
              setNotice(
                `${message} 입력 내용은 보존했습니다. 다시 시작해 주세요.`,
              );
            },
          );
        }
        if (secret && hasExtensionRuntime) {
          const permitted = await chrome.permissions.contains({
            origins: ["http://127.0.0.1:8787/*"],
          });
          if (permitted && !disposed) void auth.refetch();
        }
      })
      .catch((error) => {
        if (disposed) return;
        setHydrated(true);
        setNotice(readableError(error, "로컬 작업을 불러오지 못했습니다."));
      });
    void refreshLibrary();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || deletingData.current) return;
    const timer = window.setTimeout(() => {
      const workspace: WorkspaceState = {
        id: "current",
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
      };
      void db.workspaceStates.put(workspace);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activeRequest,
    candidateCount,
    evidence,
    hydrated,
    mode,
    persona,
    purpose,
    selectedCandidateId,
    sourceText,
    sourceUrl,
    variationStrength,
    view,
    workflow.candidates,
    workflow.editorText,
    workflow.error,
    workflow.finalDraft,
    workflow.future,
    workflow.generationId,
    workflow.history,
    workflow.source,
    workflow.stage,
  ]);

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
    if (!hasExtensionRuntime) {
      setNotice("브라우저 미리보기에서는 Companion 권한 요청을 생략합니다.");
      return;
    }
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
      if (hasExtensionRuntime && !(await ensureGatewayPermission())) return;
      const result = (await gateway.login("chatgpt")) as { authUrl?: string };
      if (result.authUrl) {
        if (hasExtensionRuntime)
          await chrome.tabs.create({ url: result.authUrl });
        else window.open(result.authUrl, "_blank", "noopener,noreferrer");
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
      setNotice("Codex에서 로그아웃했습니다.");
    } catch (error) {
      setNotice(readableError(error, "로그아웃에 실패했습니다."));
    } finally {
      setConnectionBusy(false);
    }
  }

  async function captureCurrent() {
    if (!hasExtensionRuntime) {
      setNotice(
        "Extension에서 Threads 탭을 열면 게시물 캡처를 사용할 수 있습니다.",
      );
      return;
    }
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return;
    const response = (await chrome.tabs
      .sendMessage(tab.id, {
        type: "CAPTURE_CURRENT_POST",
      } satisfies ExtensionMessage)
      .catch(() => null)) as { source?: SourceSnapshot } | null;
    if (!response?.source)
      return setNotice(
        "게시물 구조를 찾지 못했습니다. 아래에 직접 붙여넣어 주세요.",
      );
    workflow.setSource(response.source);
    setSourceText(response.source.text);
    setSourceUrl(response.source.url ?? "");
    await db.sources.put(response.source);
  }

  async function generate() {
    const normalizedSourceUrl = normalizeOptionalUrl(sourceUrl);
    if (sourceUrl.trim() && !normalizedSourceUrl)
      return setNotice("참고 URL 형식이 올바르지 않습니다.");
    const source: SourceSnapshot =
      workflow.source?.text === sourceText.trim() &&
      workflow.source.url === normalizedSourceUrl
        ? workflow.source
        : {
            id: crypto.randomUUID(),
            text: sourceText.trim(),
            author: null,
            url: normalizedSourceUrl,
            capturedAt: new Date().toISOString(),
            captureMethod: "paste",
            adapterVersion: "threads-web-v1",
          };
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
    if (!workflow.finalDraft || blocking) return;
    if (!workflow.editorText.trim())
      return setNotice("빈 글은 승인 저장할 수 없습니다.");
    if (
      workflow.finalDraft.approvalStatus === "APPROVED" &&
      workflow.finalDraft.text === workflow.editorText
    )
      return setNotice("현재 편집본은 이미 승인 저장되었습니다.");
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
      workflow.approve(approved);
      setNotice("최종 승인 Snapshot을 로컬에 저장했습니다.");
      await refreshLibrary();
    } catch (error) {
      setNotice(readableError(error, "Draft를 저장하지 못했습니다."));
    }
  }

  async function revise(scope: "hook" | "cta" | "full") {
    if (!workflow.generationId) return;
    const defaults = {
      hook: "Hook을 더 구체적이고 덜 과장되게 개선해 주세요.",
      cta: "CTA를 글의 약속과 자연스럽게 연결해 주세요.",
      full: "",
    };
    const feedback =
      scope === "full" ? window.prompt("어떻게 수정할까요?") : defaults[scope];
    if (!feedback) return;
    try {
      const revised = await gateway.reviseGeneration(
        workflow.generationId,
        scope,
        feedback,
      );
      workflow.edit(revised.text);
      setNotice("같은 Codex 작업 문맥에서 수정안을 반영했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "수정에 실패했습니다.",
      );
    }
  }

  async function handoff() {
    if (!workflow.finalDraft || blocking) return;
    if (
      workflow.finalDraft.approvalStatus !== "APPROVED" ||
      workflow.finalDraft.text !== workflow.editorText
    ) {
      return setNotice("현재 편집본을 최종 승인 저장한 뒤 전달하세요.");
    }
    try {
      await navigator.clipboard.writeText(workflow.editorText);
    } catch {
      return setNotice(
        "클립보드에 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.",
      );
    }
    if (!hasExtensionRuntime) {
      return setNotice(
        "초안을 클립보드에 복사했습니다. Extension에서 로그인된 Threads 탭으로 전달할 수 있습니다.",
      );
    }
    let result: ComposerHandoffResult;
    try {
      result = (await chrome.runtime.sendMessage({
        type: "OPEN_COMPOSER",
        text: workflow.editorText,
      } satisfies ExtensionMessage)) as ComposerHandoffResult;
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
    } else {
      setNotice(
        "Threads 로그인 상태 또는 작성창 구조를 확인하지 못했습니다. 초안은 클립보드에 보존했습니다.",
      );
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
    const blob = new Blob([JSON.stringify(await db.exportAll(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `threadflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAll() {
    if (
      !window.confirm(
        "Persona, Source, Draft, 캘린더와 설정을 모두 삭제할까요?",
      )
    )
      return;
    deletingData.current = true;
    setHydrated(false);
    await db.deleteAllUserData();
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
    setNotice("로컬 데이터를 모두 삭제했습니다.");
    window.setTimeout(() => {
      deletingData.current = false;
      setHydrated(true);
    }, 0);
  }

  async function refreshLibrary() {
    setDrafts(
      (await db.drafts.orderBy("updatedAt").reverse().toArray()).slice(0, 30),
    );
    setSlots(await db.calendarSlots.orderBy("scheduledAt").toArray());
    setPublicationLinks(await db.publicationLinks.toArray());
  }

  function restoreWorkspace(workspace: WorkspaceState) {
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
    workflow.loadDraft(draft.finalDraft, draft.candidates);
    setSelectedCandidateId(draft.finalDraft.selectedCandidateId);
    const request = draft.request ?? null;
    setActiveRequest(request);
    if (request) {
      workflow.setSource(request.source);
      setSourceText(request.source.text);
      setSourceUrl(request.source.url ?? "");
      setPersona(request.persona);
      setPurpose(request.purpose);
      setMode(request.mode);
      setVariationStrength(request.variationStrength);
      setCandidateCount(request.candidateCount);
      setEvidence(request.userEvidence.join("\n"));
    }
    setView("write");
  }

  async function consumeGenerationEvents(id: string): Promise<void> {
    for await (const event of gateway.events(id)) {
      workflow.applyEvent(event);
      if (event.type === "result")
        setSelectedCandidateId(event.finalDraft.selectedCandidateId);
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
    const granted = await chrome.permissions.request({
      origins: ["http://127.0.0.1:8787/*"],
    });
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
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">QUALITY-FIRST WRITING</span>
          <h1>
            ThreadFlow <b>OS</b>
          </h1>
        </div>
        <span className={`status ${auth.data?.authenticated ? "online" : ""}`}>
          <i aria-hidden="true" />
          {auth.data?.authenticated ? "Codex 연결됨" : "오프라인 편집 가능"}
        </span>
      </header>
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
            onClick={() => setView(id)}
            key={id}
          >
            <UiIcon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="notice">
          {notice}
          <button onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      {view === "write" && (
        <>
          <section className="card source-card">
            <div className="section-title">
              <span>01</span>
              <h2>참고 자료</h2>
              <button className="text-button" onClick={captureCurrent}>
                <UiIcon name="capture" />
                <span>현재 게시물 가져오기</span>
              </button>
            </div>
            <textarea
              className="source-input"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Threads 글 또는 메모를 직접 붙여넣으세요."
              rows={6}
            />
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
            <div className="source-meta">
              {workflow.source?.author ?? "직접 입력"} ·{" "}
              {sourceText.length.toLocaleString()}자
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <span>02</span>
              <h2>작성 전략</h2>
            </div>
            <label>
              작성 목적
              <input
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
              />
            </label>
            <div className="grid2">
              <label>
                모드
                <span className="control-with-icon">
                  <UiIcon name="sparkle" />
                  <select
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as WritingMode)
                    }
                  >
                    <option value="new">신규 작성</option>
                    <option value="polish">내 글 다듬기</option>
                    <option value="affiliate">쇼핑·제휴</option>
                    <option value="shorten">짧게</option>
                    <option value="alternate-angle">다른 관점</option>
                  </select>
                </span>
              </label>
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
            </div>
            <div className="grid2 persona-fields">
              <label>
                독자
                <span className="control-with-icon">
                  <UiIcon name="audience" />
                  <input
                    value={persona.audience}
                    onChange={(event) =>
                      setPersona({ ...persona, audience: event.target.value })
                    }
                  />
                </span>
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
            <button
              className="primary"
              disabled={
                !sourceText.trim() ||
                !["IDLE", "COMPLETED", "FAILED", "CANCELED"].includes(
                  workflow.stage,
                )
              }
              onClick={generate}
            >
              <UiIcon name="sparkle" />
              <span>품질 파이프라인 시작</span>
            </button>
          </section>

          {workflow.stage !== "IDLE" && (
            <section className="progress card">
              <div className="section-title">
                <span>03</span>
                <h2>{stages[workflow.stage] ?? workflow.stage}</h2>
                <em>
                  {workflow.stage === "COMPLETED"
                    ? "100%"
                    : ["FAILED", "CANCELED"].includes(workflow.stage)
                      ? "종료"
                      : "진행 중"}
                </em>
              </div>
              <div className="progress-track">
                <i style={{ width: `${progressFor(workflow.stage)}%` }} />
              </div>
              {!["COMPLETED", "FAILED", "CANCELED"].includes(
                workflow.stage,
              ) && (
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

          {workflow.candidates.length > 0 && (
            <section className="card">
              <div className="section-title">
                <span>04</span>
                <h2>후보 비교</h2>
              </div>
              <div className="candidates">
                {workflow.candidates.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    onClick={() => chooseCandidate(candidate.id)}
                    className={`candidate ${selectedCandidateId === candidate.id ? "selected" : ""}`}
                  >
                    <div>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span>{candidate.angle}</span>
                      <strong>{Math.round(candidate.score?.total ?? 0)}</strong>
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
            </section>
          )}

          {workflow.finalDraft && (
            <section className="card editor-card">
              <div className="section-title">
                <span>05</span>
                <h2>최종 편집</h2>
                <em>{countThreadsTextUnits(workflow.editorText)}/500</em>
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
              <div className="revision-tools">
                <button onClick={() => revise("hook")}>Hook만 개선</button>
                <button onClick={() => revise("cta")}>CTA만 개선</button>
                <button onClick={() => revise("full")}>지시해서 수정</button>
              </div>
              <textarea
                className="editor"
                value={workflow.editorText}
                onChange={(event) => workflow.edit(event.target.value)}
                rows={12}
              />
              {editorDiff.some((chunk) => chunk.type !== "equal") && (
                <div className="version-diff" aria-label="AI 초안 대비 변경점">
                  <b>AI 초안 대비 변경점</b>
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
                </div>
              )}
              <div className="risk-list">
                {liveFlags.length ? (
                  liveFlags.map((flag, index) => (
                    <div
                      key={`${flag.code}-${index}`}
                      className={`risk ${flag.severity}`}
                    >
                      <b>
                        {flag.severity === "blocking" ? "확인 필요" : "참고"}
                      </b>
                      <span>{flag.message}</span>
                      <small>{flag.evidence}</small>
                    </div>
                  ))
                ) : (
                  <div className="safe">결정적 위험 검사 통과</div>
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
              <label className="file-field">
                이미지 첨부 <small>MVP는 Threads 화면에서 직접 첨부</small>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleImage(event.target.files?.[0])}
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
              <div className="actions">
                <button
                  className="secondary"
                  disabled={
                    blocking ||
                    !workflow.editorText.trim() ||
                    (workflow.finalDraft.approvalStatus === "APPROVED" &&
                      workflow.finalDraft.text === workflow.editorText)
                  }
                  onClick={approveAndSave}
                >
                  최종 승인 저장
                </button>
                <button
                  className="primary"
                  disabled={
                    blocking ||
                    !workflow.editorText ||
                    workflow.finalDraft.approvalStatus !== "APPROVED" ||
                    workflow.finalDraft.text !== workflow.editorText
                  }
                  onClick={handoff}
                >
                  Threads 작성 화면으로
                </button>
              </div>
              <p className="safety-note">
                승인 저장 후에만 전달됩니다. Extension은 게시·예약 확정 버튼을
                클릭하지 않습니다.
              </p>
            </section>
          )}
        </>
      )}

      {view === "library" && (
        <section className="card">
          <div className="section-title">
            <span>LIB</span>
            <h2>Draft 버전</h2>
            <button className="text-button" onClick={refreshLibrary}>
              새로고침
            </button>
          </div>
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
          {drafts.length ? (
            drafts.map((draft) => {
              const publication = publicationLinks.find(
                (item) => item.draftId === draft.id,
              );
              return (
                <div
                  className="library-item"
                  key={`${draft.id}-${draft.version}`}
                >
                  <button
                    className="library-row"
                    onClick={() => loadStoredDraft(draft)}
                  >
                    <b>v{draft.version}</b>
                    <span>{draft.text.slice(0, 90)}</span>
                    <time>{new Date(draft.updatedAt).toLocaleString()}</time>
                  </button>
                  <div className="library-actions">
                    <button
                      className="link-result"
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
                </div>
              );
            })
          ) : (
            <p className="empty">승인 저장한 Draft가 없습니다.</p>
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
          <div className="section-title">
            <span>SET</span>
            <h2>연결과 데이터</h2>
          </div>
          <label>
            Companion 연결 키
            <input
              type="password"
              value={bootstrapSecret}
              onChange={(event) => setBootstrapSecret(event.target.value)}
              placeholder="session-secret 파일 안의 키 문자열"
            />
          </label>
          <div className="actions">
            <button
              className="secondary"
              disabled={connectionBusy}
              onClick={saveSecret}
            >
              키 저장
            </button>
            <button
              className="primary"
              disabled={connectionBusy}
              onClick={connect}
            >
              {connectionBusy ? "확인 중…" : "Codex 상태 확인"}
            </button>
          </div>
          {auth.data && (
            <div className="account-box">
              <b>{auth.data.accountType ?? "로그아웃됨"}</b>
              <span>{auth.data.planType ?? "—"}</span>
              <span>Provider {auth.data.providerVersion ?? "—"}</span>
            </div>
          )}
          {!auth.data?.authenticated ? (
            <button className="wide" disabled={connectionBusy} onClick={login}>
              ChatGPT 구독으로 로그인
            </button>
          ) : (
            <button className="wide" disabled={connectionBusy} onClick={logout}>
              로그아웃
            </button>
          )}
          <hr />
          <button className="wide" onClick={exportData}>
            로컬 데이터 내보내기
          </button>
          <button className="wide danger" onClick={deleteAll}>
            로컬 데이터 전체 삭제
          </button>
          <p className="safety-note">
            OAuth Access/Refresh Token은 Extension에 저장되지 않습니다.
          </p>
        </section>
      )}
    </main>
  );
}

function progressFor(stage: string): number {
  const order = [
    "QUEUED",
    "ANALYZING",
    "STRATEGIZING",
    "GENERATING",
    "CRITIQUING",
    "REFINING",
    "CHECKING",
    "COMPLETED",
  ];
  const index = order.indexOf(stage);
  return index < 0 ? 0 : Math.round((index / (order.length - 1)) * 100);
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
