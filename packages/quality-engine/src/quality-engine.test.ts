import { describe, expect, it } from "vitest";
import type {
  GenerationEvent,
  GenerationRequest,
} from "@threadflow-os/contracts";
import {
  QualityPipeline,
  candidateDiversity,
  deterministicFlags,
  jaccardSimilarity,
} from "./index.js";

const request: GenerationRequest = {
  source: {
    id: "source-1",
    text: "매일 아침 한 문장을 쓰는 작은 습관이 생각을 정리하는 데 도움이 됩니다.",
    author: "author",
    url: null,
    capturedAt: "2026-09-04T00:00:00.000Z",
    captureMethod: "paste",
    adapterVersion: "threads-web-v1",
  },
  persona: {
    id: "persona-1",
    name: "실무 코치",
    audience: "글쓰기를 시작하는 직장인",
    voice: "차분하고 구체적",
    goals: ["실행"],
    bannedPhrases: ["무조건 성공"],
    preferredLength: { min: 20, max: 800 },
    language: "ko-KR",
  },
  purpose: "글쓰기 실행을 돕는다",
  mode: "new",
  variationStrength: 0.8,
  candidateCount: 3,
  userEvidence: [],
  affiliateDisclosure: null,
};

const score = {
  hook: 80,
  originality: 80,
  readability: 80,
  personaFit: 80,
  evidence: 80,
  cta: 80,
  policy: 80,
  total: 80,
};

describe("deterministic quality checks", () => {
  it("detects source similarity and unsupported claims", () => {
    expect(jaccardSimilarity(request.source.text, request.source.text)).toBe(1);
    const flags = deterministicFlags(
      request,
      `${request.source.text} 2026년 수익 30% 보장`,
    );
    expect(flags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining(["SOURCE_SIMILARITY", "UNSUPPORTED_CLAIM"]),
    );
  });

  it("forces affiliate disclosure and banned phrases", () => {
    const flags = deterministicFlags(
      { ...request, mode: "affiliate" },
      "무조건 성공하는 제품을 소개합니다.",
    );
    expect(flags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining(["BANNED_PHRASE", "AFFILIATE_DISCLOSURE_MISSING"]),
    );
  });

  it("requires the configured affiliate disclosure to exist in the output", () => {
    const affiliateRequest = {
      ...request,
      mode: "affiliate" as const,
      affiliateDisclosure: "이 글에는 제휴 링크가 포함될 수 있습니다.",
    };
    expect(
      deterministicFlags(affiliateRequest, "제품의 장단점을 정리했습니다.").map(
        (flag) => flag.code,
      ),
    ).toContain("AFFILIATE_DISCLOSURE_MISSING");
    expect(
      deterministicFlags(
        affiliateRequest,
        "제품의 장단점을 정리했습니다. 이 글에는 제휴 링크가 포함될 수 있습니다.",
      ).map((flag) => flag.code),
    ).not.toContain("AFFILIATE_DISCLOSURE_MISSING");
  });

  it("measures candidate diversity", () => {
    const base = {
      id: "a",
      hook: "h",
      body: "b",
      cta: "",
      angle: "a",
      rationale: "r",
      score: null,
      riskFlags: [],
    };
    expect(
      candidateDiversity([
        { ...base, text: "같은 문장입니다" },
        { ...base, id: "b", text: "같은 문장입니다" },
      ]),
    ).toBe(0);
  });

  it("blocks drafts that exceed the Threads 500-unit limit", () => {
    const flags = deterministicFlags(request, "가".repeat(501));
    expect(flags.map((flag) => flag.code)).toContain("THREADS_LIMIT_EXCEEDED");
  });
});

describe("quality pipeline", () => {
  it("runs all quality stages and emits a final result", async () => {
    const outputs = [
      {
        hookPattern: "질문형",
        structure: ["문제", "행동"],
        emotion: ["안도"],
        ctaPattern: "질문",
        claimRisks: [],
        doNotReuse: ["매일 아침"],
      },
      {
        angles: ["환경 설계", "실패 기록", "독자 약속"],
        voiceRules: ["짧게"],
        evidenceRules: ["근거 추가 금지"],
        differentiationRules: ["Hook 분리"],
      },
      {
        candidates: [
          {
            hook: "빈 화면이 부담스럽나요?",
            body: "먼저 제목 대신 관찰 한 줄을 적어보세요.",
            cta: "오늘 한 줄은 무엇인가요?",
            angle: "환경",
            rationale: "진입 장벽 완화",
          },
          {
            hook: "잘 쓴 날보다 다시 쓴 날을 기록하세요.",
            body: "중단 이후 돌아오는 장치를 만들면 습관이 이어집니다.",
            cta: "돌아올 신호를 정해보세요.",
            angle: "복귀",
            rationale: "실패 관점",
          },
          {
            hook: "독자 한 명에게 답장하듯 시작해보세요.",
            body: "대상이 선명하면 단어 선택도 자연스럽게 좁혀집니다.",
            cta: "누구에게 쓸 건가요?",
            angle: "독자",
            rationale: "독자 중심",
          },
        ],
      },
      {
        ranked: [0, 1, 2].map((candidateIndex) => ({
          candidateIndex,
          score,
          strengths: ["명확함"],
          weaknesses: [],
        })),
      },
      {
        selectedCandidateIndex: 1,
        text: "중단해도 괜찮습니다. 다시 쓰기 쉬운 신호 하나를 정해두세요. 오늘 돌아올 신호는 무엇인가요?",
        score,
      },
    ];
    const provider = { generateJson: async () => outputs.shift() };
    const events: GenerationEvent[] = [];
    const result = await new QualityPipeline(provider).run(
      "generation-1",
      request,
      (event) => events.push(event),
    );
    expect(result.candidates).toHaveLength(3);
    expect(result.finalDraft.promptVersion).toBe("2.0.0");
    expect(
      events.some(
        (event) => event.type === "state" && event.state === "COMPLETED",
      ),
    ).toBe(true);
  });

  it("automatically rewrites a final draft that is too similar to the source", async () => {
    let refineCalls = 0;
    const provider = {
      generateJson: async ({ stage }: { stage: string }) => {
        if (stage === "ANALYZING")
          return {
            hookPattern: "설명",
            structure: [],
            emotion: [],
            ctaPattern: "질문",
            claimRisks: [],
            doNotReuse: [],
          };
        if (stage === "STRATEGIZING")
          return {
            angles: ["환경", "복귀", "독자"],
            voiceRules: [],
            evidenceRules: [],
            differentiationRules: [],
          };
        if (stage === "GENERATING")
          return {
            candidates: [
              {
                hook: "시작이 어렵나요?",
                body: "기록할 장소부터 정해보세요.",
                cta: "어디에서 시작할까요?",
                angle: "환경",
                rationale: "환경 설계",
              },
              {
                hook: "중단은 실패가 아닙니다.",
                body: "돌아오는 신호를 먼저 만드세요.",
                cta: "복귀 신호는 무엇인가요?",
                angle: "복귀",
                rationale: "회복",
              },
              {
                hook: "한 사람을 정해보세요.",
                body: "그 사람의 질문에 답하듯 씁니다.",
                cta: "누구에게 쓸까요?",
                angle: "독자",
                rationale: "독자 초점",
              },
            ],
          };
        if (stage === "CRITIQUING")
          return {
            ranked: [0, 1, 2].map((candidateIndex) => ({
              candidateIndex,
              score,
              strengths: [],
              weaknesses: [],
            })),
          };
        refineCalls += 1;
        return refineCalls === 1
          ? { selectedCandidateIndex: 0, text: request.source.text, score }
          : {
              selectedCandidateIndex: 0,
              text: "빈 화면을 이기려 애쓰기보다, 오늘 관찰한 장면 하나를 특정 독자에게 답장하듯 적어보세요.",
              score,
            };
      },
    };
    const result = await new QualityPipeline(provider).run(
      "generation-repair",
      request,
      () => undefined,
    );
    expect(refineCalls).toBe(2);
    expect(result.finalDraft.riskFlags.map((flag) => flag.code)).not.toContain(
      "SOURCE_SIMILARITY",
    );
  });

  it("rejects duplicate or incomplete critic rankings", async () => {
    const outputs = [
      {
        hookPattern: "설명",
        structure: [],
        emotion: [],
        ctaPattern: "질문",
        claimRisks: [],
        doNotReuse: [],
      },
      {
        angles: ["환경", "복귀", "독자"],
        voiceRules: [],
        evidenceRules: [],
        differentiationRules: [],
      },
      {
        candidates: [0, 1, 2].map((index) => ({
          hook: `서로 다른 시작 ${index}`,
          body: `서로 다른 본문 내용 ${index}`,
          cta: `질문 ${index}`,
          angle: `관점 ${index}`,
          rationale: `이유 ${index}`,
        })),
      },
      {
        ranked: [0, 0, 2].map((candidateIndex) => ({
          candidateIndex,
          score,
          strengths: [],
          weaknesses: [],
        })),
      },
    ];
    const provider = { generateJson: async () => outputs.shift() };
    await expect(
      new QualityPipeline(provider).run(
        "generation-invalid-rank",
        request,
        () => undefined,
      ),
    ).rejects.toThrow("critic ranking");
  });
});
