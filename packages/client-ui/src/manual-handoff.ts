import {
  countThreadsTextUnits,
  type FinalDraft,
  type GenerationRequest,
  type RiskFlag,
  type SourceSnapshot,
} from "@threadflow-os/contracts";
import {
  canonicalJson,
  generationRequestFingerprint,
  sha256Hex,
} from "@threadflow-os/shared/fingerprint";
import { assertProviderOutputSafe } from "@threadflow-os/shared/runtime-security";

export const APPROVAL_SNAPSHOT_VERSION = "threadflow-approval-snapshot/v1";
export const MANUAL_HANDOFF_PACK_VERSION = "threadflow-manual-handoff/v1";

export type SelectedImageReference = {
  name: string;
  size: number;
  altText: string;
  mimeType?: string;
  sha256?: string;
};

export type ApprovalRiskSnapshot = Pick<
  RiskFlag,
  "code" | "severity" | "requiresReview"
>;

export type ApprovalSnapshot = {
  schemaVersion: typeof APPROVAL_SNAPSHOT_VERSION;
  fingerprint: string;
  draftId: string;
  generationId: string;
  draftVersion: number;
  textHash: string;
  requestFingerprint: string | null;
  sourceHash: string | null;
  riskHash: string;
  risks: ApprovalRiskSnapshot[];
  target: { platform: "threads"; accountId: null };
  image: SelectedImageReference | null;
  approvedAt: string;
};

export type ApprovalContext = {
  draft: FinalDraft;
  text: string;
  request: GenerationRequest | null;
  source: SourceSnapshot | null;
  riskFlags: RiskFlag[];
  image: SelectedImageReference | null;
};

export type ManualHandoffPack = {
  schemaVersion: typeof MANUAL_HANDOFF_PACK_VERSION;
  packId: string;
  approvalFingerprint: string;
  draftId: string;
  draftVersion: number;
  target: { platform: "threads"; accountId: null };
  copy: { body: string; textHash: string; threadsUnits: number };
  sourceHash: string | null;
  riskHash: string;
  asset:
    | { status: "not-included" }
    | {
        status: "manual-reference";
        filename: string;
        size: number;
        mimeType: string;
        sha256: string;
        altText: string;
      };
  approvedAt: string;
  createdAt: string;
  credentialFree: true;
  networkWriteCount: 0;
  nextStep: string;
};

function normalizedRisks(flags: RiskFlag[]): ApprovalRiskSnapshot[] {
  return flags
    .map(({ code, severity, requiresReview }) => ({
      code,
      severity,
      requiresReview,
    }))
    .sort((left, right) =>
      `${left.code}:${left.severity}`.localeCompare(
        `${right.code}:${right.severity}`,
      ),
    );
}

function normalizeImage(
  image: SelectedImageReference | null,
): SelectedImageReference | null {
  if (!image) return null;
  const altText = image.altText.trim();
  if (!altText)
    throw new Error(
      "APPROVAL_IMAGE_INVALID: 이미지 Alt Text를 입력한 후 승인하세요.",
    );
  if (
    !image.mimeType?.startsWith("image/") ||
    !Number.isSafeInteger(image.size) ||
    image.size < 1 ||
    !/^[a-f0-9]{64}$/u.test(image.sha256 ?? "")
  )
    throw new Error(
      "APPROVAL_IMAGE_INVALID: 이미지 무결성 확인이 끝나지 않았습니다. 파일을 다시 선택하세요.",
    );
  return {
    name: image.name,
    size: image.size,
    altText,
    mimeType: image.mimeType,
    sha256: image.sha256!,
  };
}

function sourceHash(
  request: GenerationRequest | null,
  source: SourceSnapshot | null,
): string | null {
  const value = request?.source ?? source;
  return value ? sha256Hex(canonicalJson(value)) : null;
}

function comparableSnapshot(
  snapshot: Omit<ApprovalSnapshot, "fingerprint">,
): Omit<ApprovalSnapshot, "fingerprint"> {
  return snapshot;
}

export function createApprovalSnapshot(
  context: ApprovalContext & { draftVersion: number },
): ApprovalSnapshot {
  if (
    context.draft.approvalStatus !== "APPROVED" ||
    !context.draft.approvedAt ||
    context.draft.text !== context.text ||
    context.draftVersion < 1
  )
    throw new Error(
      "APPROVAL_SNAPSHOT_INVALID: 승인된 현재 본문과 버전이 필요합니다.",
    );
  const risks = normalizedRisks(context.riskFlags);
  const image = normalizeImage(context.image);
  const comparable: Omit<ApprovalSnapshot, "fingerprint"> = {
    schemaVersion: APPROVAL_SNAPSHOT_VERSION,
    draftId: context.draft.id,
    generationId: context.draft.generationId,
    draftVersion: context.draftVersion,
    textHash: sha256Hex(context.text),
    requestFingerprint: context.request
      ? generationRequestFingerprint(context.request)
      : null,
    sourceHash: sourceHash(context.request, context.source),
    riskHash: sha256Hex(canonicalJson(risks)),
    risks,
    target: { platform: "threads", accountId: null },
    image,
    approvedAt: context.draft.approvedAt,
  };
  assertProviderOutputSafe({ ...comparable, text: context.text });
  return {
    ...comparable,
    fingerprint: sha256Hex(canonicalJson(comparable)),
  };
}

export function assertApprovalSnapshot(
  value: ApprovalSnapshot,
): ApprovalSnapshot {
  if (
    value?.schemaVersion !== APPROVAL_SNAPSHOT_VERSION ||
    !/^[a-f0-9]{64}$/u.test(value.fingerprint) ||
    !/^[a-f0-9]{64}$/u.test(value.textHash) ||
    !/^[a-f0-9]{64}$/u.test(value.riskHash) ||
    !value.draftId ||
    !value.generationId ||
    !Number.isSafeInteger(value.draftVersion) ||
    value.draftVersion < 1 ||
    Number.isNaN(Date.parse(value.approvedAt)) ||
    value.target?.platform !== "threads" ||
    value.target.accountId !== null ||
    !Array.isArray(value.risks)
  )
    throw new Error(
      "APPROVAL_SNAPSHOT_INVALID: 승인 snapshot 형식이 올바르지 않습니다.",
    );
  normalizeImage(value.image);
  assertProviderOutputSafe(value);
  const { fingerprint, ...comparable } = value;
  if (sha256Hex(canonicalJson(comparableSnapshot(comparable))) !== fingerprint)
    throw new Error(
      "APPROVAL_SNAPSHOT_INVALID: 승인 snapshot 지문이 다릅니다.",
    );
  return value;
}

export function approvalInvalidationReasons(
  snapshot: ApprovalSnapshot | null,
  context: ApprovalContext,
): string[] {
  if (!snapshot) return ["APPROVAL_SNAPSHOT_MISSING"];
  try {
    assertApprovalSnapshot(snapshot);
  } catch {
    return ["APPROVAL_SNAPSHOT_INVALID"];
  }
  const reasons: string[] = [];
  if (
    snapshot.draftId !== context.draft.id ||
    snapshot.generationId !== context.draft.generationId
  )
    reasons.push("DRAFT_CHANGED");
  if (snapshot.textHash !== sha256Hex(context.text))
    reasons.push("TEXT_CHANGED");
  const currentRequestFingerprint = context.request
    ? generationRequestFingerprint(context.request)
    : null;
  if (snapshot.requestFingerprint !== currentRequestFingerprint)
    reasons.push("REQUEST_CHANGED");
  if (snapshot.sourceHash !== sourceHash(context.request, context.source))
    reasons.push("SOURCE_CHANGED");
  const risks = normalizedRisks(context.riskFlags);
  if (snapshot.riskHash !== sha256Hex(canonicalJson(risks)))
    reasons.push("RISKS_CHANGED");
  try {
    if (
      canonicalJson(snapshot.image) !==
      canonicalJson(normalizeImage(context.image))
    )
      reasons.push("IMAGE_CHANGED");
  } catch {
    reasons.push("IMAGE_INVALID");
  }
  return reasons;
}

export function createManualHandoffPack(
  snapshot: ApprovalSnapshot,
  context: ApprovalContext,
  createdAt = new Date().toISOString(),
): ManualHandoffPack {
  assertApprovalSnapshot(snapshot);
  const reasons = approvalInvalidationReasons(snapshot, context);
  if (reasons.length)
    throw new Error(
      `APPROVAL_INVALIDATED: 현재 작업이 승인본과 다릅니다 (${reasons.join(",")}).`,
    );
  if (Number.isNaN(Date.parse(createdAt)))
    throw new Error("MANUAL_HANDOFF_INVALID: 전달 pack 시각이 잘못됐습니다.");
  const asset: ManualHandoffPack["asset"] = snapshot.image
    ? {
        status: "manual-reference",
        filename: snapshot.image.name,
        size: snapshot.image.size,
        mimeType: snapshot.image.mimeType!,
        sha256: snapshot.image.sha256!,
        altText: snapshot.image.altText,
      }
    : { status: "not-included" };
  const base: Omit<ManualHandoffPack, "packId"> = {
    schemaVersion: MANUAL_HANDOFF_PACK_VERSION,
    approvalFingerprint: snapshot.fingerprint,
    draftId: snapshot.draftId,
    draftVersion: snapshot.draftVersion,
    target: snapshot.target,
    copy: {
      body: context.text,
      textHash: snapshot.textHash,
      threadsUnits: countThreadsTextUnits(context.text),
    },
    sourceHash: snapshot.sourceHash,
    riskHash: snapshot.riskHash,
    asset,
    approvedAt: snapshot.approvedAt,
    createdAt: new Date(createdAt).toISOString(),
    credentialFree: true as const,
    networkWriteCount: 0 as const,
    nextStep:
      "Threads 작성창에서 본문과 선택한 이미지를 직접 확인한 후 게시·예약한다.",
  };
  const pack: ManualHandoffPack = {
    ...base,
    packId: `handoff_${sha256Hex(canonicalJson(base)).slice(0, 20)}`,
  };
  assertProviderOutputSafe(pack);
  return pack;
}
