import { describe, expect, it } from "vitest";
import type { FinalDraft, GenerationRequest } from "@threadflow-os/contracts";
import {
  approvalInvalidationReasons,
  assertApprovalSnapshot,
  createApprovalSnapshot,
  createManualHandoffPack,
  type ApprovalContext,
} from "./manual-handoff.js";

const request: GenerationRequest = {
  source: {
    id: "source-1",
    text: "참고 글",
    author: null,
    url: null,
    capturedAt: "2026-09-07T00:00:00.000Z",
    captureMethod: "paste",
    adapterVersion: "threads-web-v1",
  },
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
  purpose: "승인 무결성",
  mode: "new",
  variationStrength: 0.8,
  candidateCount: 3,
  userEvidence: ["사용자 근거"],
  affiliateDisclosure: null,
};
const draft: FinalDraft = {
  id: "draft-1",
  generationId: "generation-1",
  selectedCandidateId: "candidate-1",
  text: "승인한 최종 본문",
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
  approvalStatus: "APPROVED",
  promptVersion: "2.0.0",
  rubricVersion: "1.0.0",
  createdAt: "2026-09-07T00:00:00.000Z",
  approvedAt: "2026-09-07T01:00:00.000Z",
};
const context = (): ApprovalContext => ({
  draft,
  text: draft.text,
  request,
  source: request.source,
  riskFlags: [],
  image: {
    name: "sample.png",
    size: 100,
    mimeType: "image/png",
    sha256: "a".repeat(64),
    altText: "샘플 이미지",
  },
});

describe("approval snapshot integrity", () => {
  it("binds the approved text, request, source, risks, and image reference", () => {
    const current = context();
    const snapshot = createApprovalSnapshot({ ...current, draftVersion: 2 });
    expect(assertApprovalSnapshot(snapshot)).toBe(snapshot);
    expect(approvalInvalidationReasons(snapshot, current)).toEqual([]);
    const pack = createManualHandoffPack(
      snapshot,
      current,
      "2026-09-07T02:00:00.000Z",
    );
    expect(pack).toMatchObject({
      draftVersion: 2,
      credentialFree: true,
      networkWriteCount: 0,
      asset: { status: "manual-reference", sha256: "a".repeat(64) },
      copy: { body: draft.text },
    });
  });

  it("invalidates changed content, source facts, risks, alt text, and bytes", () => {
    const current = context();
    const snapshot = createApprovalSnapshot({ ...current, draftVersion: 1 });
    expect(
      approvalInvalidationReasons(snapshot, {
        ...current,
        text: "변경된 본문",
        request: {
          ...request,
          source: { ...request.source, text: "변경된 소스" },
          userEvidence: ["변경된 근거"],
        },
        riskFlags: [
          {
            code: "POLICY_REVIEW",
            severity: "warning",
            message: "검토",
            evidence: null,
            requiresReview: true,
          },
        ],
        image: {
          ...current.image!,
          altText: "변경된 대체 텍스트",
          sha256: "b".repeat(64),
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "TEXT_CHANGED",
        "REQUEST_CHANGED",
        "SOURCE_CHANGED",
        "RISKS_CHANGED",
        "IMAGE_CHANGED",
      ]),
    );
  });

  it("rejects tampering and credential-shaped approved content", () => {
    const current = context();
    const snapshot = createApprovalSnapshot({ ...current, draftVersion: 1 });
    expect(() =>
      assertApprovalSnapshot({ ...snapshot, sourceHash: "b".repeat(64) }),
    ).toThrow("지문");
    expect(() =>
      createApprovalSnapshot({
        ...current,
        text: `Bearer ${"x".repeat(24)}`,
        draft: { ...draft, text: `Bearer ${"x".repeat(24)}` },
        draftVersion: 1,
      }),
    ).toThrow("SENSITIVE_PROVIDER_OUTPUT");
  });

  it("supports a credential-free text-only handoff", () => {
    const current = { ...context(), image: null };
    const snapshot = createApprovalSnapshot({ ...current, draftVersion: 1 });
    expect(createManualHandoffPack(snapshot, current).asset).toEqual({
      status: "not-included",
    });
  });
});
