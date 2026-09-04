import { z } from "zod";
import {
  DraftCandidateSchema,
  FinalDraftSchema,
  GenerationRequestSchema,
  QualityScoreSchema,
  type DraftCandidate,
  type FinalDraft,
  type GenerationEvent,
  type GenerationRequest,
  type GenerationState,
  type QualityScore,
} from "@threadflow-os/contracts";
import {
  buildAnalysisPrompt,
  buildCandidatesPrompt,
  buildCriticPrompt,
  buildFinalPrompt,
  buildSimilarityRepairPrompt,
  candidatesJsonSchema,
  criticJsonSchema,
  finalJsonSchema,
  PROMPT_VERSION,
  RUBRIC_VERSION,
  sourceAnalysisJsonSchema,
  strategyJsonSchema,
  buildStrategyPrompt,
} from "@threadflow-os/prompt-kit";
import { createId, nowIso } from "@threadflow-os/shared";
import { deterministicFlags, mergeScores } from "./deterministic.js";

const SourceAnalysisSchema = z.object({
  hookPattern: z.string(),
  structure: z.array(z.string()),
  emotion: z.array(z.string()),
  ctaPattern: z.string(),
  claimRisks: z.array(z.string()),
  doNotReuse: z.array(z.string()),
});

const StrategySchema = z.object({
  angles: z.array(z.string()).min(3).max(5),
  voiceRules: z.array(z.string()),
  evidenceRules: z.array(z.string()),
  differentiationRules: z.array(z.string()),
});

const RawCandidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        hook: z.string().min(1),
        body: z.string().min(1),
        cta: z.string(),
        angle: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .min(3)
    .max(5),
});

const CriticSchema = z.object({
  ranked: z
    .array(
      z.object({
        candidateIndex: z.number().int().min(0).max(4),
        score: QualityScoreSchema,
        strengths: z.array(z.string()),
        weaknesses: z.array(z.string()),
      }),
    )
    .min(3)
    .max(5),
});

const FinalOutputSchema = z.object({
  selectedCandidateIndex: z.number().int().min(0).max(4),
  text: z.string().min(1),
  score: QualityScoreSchema,
});

export type StructuredCall = {
  stage: GenerationState;
  prompt: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
};

export interface StructuredTextProvider {
  generateJson(call: StructuredCall): Promise<unknown>;
  revise?(
    threadId: string,
    prompt: string,
    schema: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export type PipelineResult = {
  candidates: DraftCandidate[];
  finalDraft: FinalDraft;
};

export class QualityPipeline {
  constructor(private readonly provider: StructuredTextProvider) {}

  async run(
    generationId: string,
    input: GenerationRequest,
    emit: (event: GenerationEvent) => void,
    signal?: AbortSignal,
  ): Promise<PipelineResult> {
    const request = GenerationRequestSchema.parse(input);
    const call = async <T>(
      state: GenerationState,
      prompt: string,
      schema: Record<string, unknown>,
      parser: z.ZodType<T>,
    ): Promise<T> => {
      this.ensureActive(signal);
      emit({ type: "state", generationId, state, at: nowIso() });
      const output = await this.provider.generateJson({
        stage: state,
        prompt,
        schema,
        ...(signal ? { signal } : {}),
        onDelta: (delta) =>
          emit({
            type: "delta",
            generationId,
            stage: state,
            delta,
            at: nowIso(),
          }),
      });
      return parser.parse(output);
    };

    const analysis = await call(
      "ANALYZING",
      buildAnalysisPrompt(request),
      sourceAnalysisJsonSchema,
      SourceAnalysisSchema,
    );
    const strategy = await call(
      "STRATEGIZING",
      buildStrategyPrompt(request, analysis),
      strategyJsonSchema,
      StrategySchema,
    );
    const raw = await call(
      "GENERATING",
      buildCandidatesPrompt(request, strategy),
      candidatesJsonSchema,
      RawCandidatesSchema,
    );
    if (raw.candidates.length !== request.candidateCount) {
      throw new Error(
        `INVALID_OUTPUT: expected ${request.candidateCount} candidates, received ${raw.candidates.length}`,
      );
    }
    const candidates: DraftCandidate[] = raw.candidates.map((candidate) =>
      DraftCandidateSchema.parse({
        id: createId("candidate"),
        ...candidate,
        text: [candidate.hook, candidate.body, candidate.cta]
          .filter(Boolean)
          .join("\n\n"),
        score: null,
        riskFlags: [],
      }),
    );
    const critique = await call(
      "CRITIQUING",
      buildCriticPrompt(request, candidates),
      criticJsonSchema,
      CriticSchema,
    );
    const rankedIndexes = critique.ranked.map((entry) => entry.candidateIndex);
    if (
      rankedIndexes.length !== candidates.length ||
      new Set(rankedIndexes).size !== candidates.length ||
      rankedIndexes.some((index) => index >= candidates.length)
    ) {
      throw new Error(
        "INVALID_OUTPUT: critic ranking must contain every candidate exactly once",
      );
    }
    const scoredCandidates = candidates.map((candidate, index) => {
      const modelScore =
        critique.ranked.find((entry) => entry.candidateIndex === index)
          ?.score ?? defaultScore();
      const riskFlags = deterministicFlags(
        request,
        candidate.text,
        candidates.filter((_, peer) => peer !== index),
      );
      return DraftCandidateSchema.parse({
        ...candidate,
        score: mergeScores(modelScore, riskFlags),
        riskFlags,
      });
    });
    let finalOutput = await call(
      "REFINING",
      buildFinalPrompt(request, scoredCandidates, critique),
      finalJsonSchema,
      FinalOutputSchema,
    );
    this.ensureCandidateIndex(
      finalOutput.selectedCandidateIndex,
      scoredCandidates,
    );
    emit({ type: "state", generationId, state: "CHECKING", at: nowIso() });
    let finalFlags = deterministicFlags(request, finalOutput.text);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const similarity = finalFlags.find(
        (flag) => flag.code === "SOURCE_SIMILARITY",
      );
      if (!similarity) break;
      finalOutput = await call(
        "REFINING",
        buildSimilarityRepairPrompt(
          request,
          finalOutput.text,
          similarity.evidence ?? similarity.message,
        ),
        finalJsonSchema,
        FinalOutputSchema,
      );
      this.ensureCandidateIndex(
        finalOutput.selectedCandidateIndex,
        scoredCandidates,
      );
      emit({ type: "state", generationId, state: "CHECKING", at: nowIso() });
      finalFlags = deterministicFlags(request, finalOutput.text);
    }
    const selected = scoredCandidates[finalOutput.selectedCandidateIndex]!;
    const finalDraft = FinalDraftSchema.parse({
      id: createId("draft"),
      generationId,
      selectedCandidateId: selected.id,
      text: finalOutput.text,
      score: mergeScores(finalOutput.score, finalFlags),
      riskFlags: finalFlags,
      approvalStatus: finalFlags.some((flag) => flag.severity === "blocking")
        ? "REVIEW_REQUIRED"
        : "DRAFT",
      promptVersion: PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      createdAt: nowIso(),
      approvedAt: null,
    });
    const result = { candidates: scoredCandidates, finalDraft };
    emit({ type: "result", generationId, ...result, at: nowIso() });
    emit({ type: "state", generationId, state: "COMPLETED", at: nowIso() });
    return result;
  }

  private ensureActive(signal?: AbortSignal): void {
    if (signal?.aborted)
      throw new DOMException("Generation canceled", "AbortError");
  }

  private ensureCandidateIndex(
    index: number,
    candidates: DraftCandidate[],
  ): void {
    if (!candidates[index])
      throw new Error(
        `INVALID_OUTPUT: selected candidate ${index} does not exist`,
      );
  }
}

function defaultScore(): QualityScore {
  return {
    hook: 50,
    originality: 50,
    readability: 50,
    personaFit: 50,
    evidence: 50,
    cta: 50,
    policy: 50,
    total: 50,
  };
}
