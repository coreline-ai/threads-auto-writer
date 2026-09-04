import { describe, expect, it } from "vitest";
import {
  ApprovedDraftSyncSchema,
  AuthStatusSchema,
  countThreadsTextUnits,
  DraftCandidateSchema,
  GenerationRequestSchema,
  GenerationStateSchema,
  RiskFlagSchema,
} from "./index.js";

const fixture = {
  source: {
    id: "source-1",
    text: "매일 한 문장씩 기록해 보세요.",
    author: "writer",
    url: "https://www.threads.com/@writer/post/abc",
    capturedAt: "2026-09-04T00:00:00.000Z",
    captureMethod: "article",
    adapterVersion: "threads-web-v1",
  },
  persona: {
    id: "persona-1",
    name: "차분한 실무자",
    audience: "콘텐츠를 시작하는 직장인",
    voice: "간결하고 친절하게",
    goals: ["실행 유도"],
    bannedPhrases: ["무조건 성공"],
    preferredLength: { min: 80, max: 500 },
    language: "ko-KR",
  },
  purpose: "글쓰기 습관을 돕는다",
  mode: "new",
  variationStrength: 0.8,
  candidateCount: 4,
  userEvidence: [],
  affiliateDisclosure: null,
} as const;

describe("shared contracts", () => {
  it("round-trips a generation request fixture", () => {
    expect(GenerationRequestSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects invalid state, score and risk code", () => {
    expect(() => GenerationStateSchema.parse("RUNNING")).toThrow();
    expect(() =>
      DraftCandidateSchema.parse({
        id: "x",
        hook: "h",
        body: "b",
        cta: "",
        text: "h\nb",
        angle: "a",
        rationale: "r",
        score: {
          hook: 101,
          originality: 80,
          readability: 80,
          personaFit: 80,
          evidence: 80,
          cta: 80,
          policy: 80,
          total: 80,
        },
        riskFlags: [],
      }),
    ).toThrow();
    expect(() =>
      RiskFlagSchema.parse({
        code: "UNKNOWN",
        severity: "warning",
        message: "x",
        evidence: null,
        requiresReview: true,
      }),
    ).toThrow();
    expect(
      ApprovedDraftSyncSchema.safeParse({
        tenantId: "tenant",
        workspaceId: "workspace",
        threadsAccountId: "account",
        draft: {
          id: "draft",
          generationId: "generation",
          selectedCandidateId: "candidate",
          text: "승인 시각이 없는 글",
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
          createdAt: "2026-09-04T00:00:00.000Z",
          approvedAt: null,
        },
        scheduledAt: "2026-09-05T00:00:00.000Z",
        timezone: "Asia/Seoul",
        imageUrl: null,
        altText: null,
      }).success,
    ).toBe(false);
  });

  it("does not permit OAuth token material in auth DTOs", () => {
    const parsed = AuthStatusSchema.parse({
      authenticated: true,
      accountType: "chatgpt",
      planType: "pro",
      requiresOpenaiAuth: true,
      rateLimits: null,
      providerVersion: "0.145.0",
      accessToken: "must-not-survive",
    });
    expect(parsed).not.toHaveProperty("accessToken");
  });

  it("counts ordinary characters once and emoji by UTF-8 bytes", () => {
    expect(countThreadsTextUnits("한글 A")).toBe(4);
    expect(countThreadsTextUnits("😀")).toBe(4);
  });

  it("handles empty, minimal, oversized, emoji-only, and link-only sources", () => {
    const withText = (text: string) => ({
      ...fixture,
      source: { ...fixture.source, text },
    });
    expect(GenerationRequestSchema.safeParse(withText("")).success).toBe(false);
    expect(GenerationRequestSchema.safeParse(withText("가")).success).toBe(
      true,
    );
    expect(GenerationRequestSchema.safeParse(withText("😀")).success).toBe(
      true,
    );
    expect(
      GenerationRequestSchema.safeParse(
        withText("https://www.threads.com/@writer/post/abc"),
      ).success,
    ).toBe(true);
    expect(
      GenerationRequestSchema.safeParse(withText("가".repeat(30_001))).success,
    ).toBe(false);
  });

  it("rejects a Persona whose preferred length range is reversed", () => {
    expect(
      GenerationRequestSchema.safeParse({
        ...fixture,
        persona: {
          ...fixture.persona,
          preferredLength: { min: 500, max: 80 },
        },
      }).success,
    ).toBe(false);
  });
});
