import { z } from "zod";

export const generationStates = [
  "QUEUED",
  "ANALYZING",
  "STRATEGIZING",
  "GENERATING",
  "CRITIQUING",
  "REFINING",
  "CHECKING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
] as const;

export const GenerationStateSchema = z.enum(generationStates);
export type GenerationState = z.infer<typeof GenerationStateSchema>;

export const ApiErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "INVALID_OUTPUT",
  "IDEMPOTENCY_CONFLICT",
  "SENSITIVE_PROVIDER_OUTPUT",
  "CANCELED",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const WritingModeSchema = z.enum([
  "new",
  "polish",
  "affiliate",
  "shorten",
  "alternate-angle",
]);
export type WritingMode = z.infer<typeof WritingModeSchema>;

export const SourceSnapshotSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(30_000),
  author: z.string().max(200).nullable().default(null),
  url: z.string().url().nullable().default(null),
  capturedAt: z.string().datetime(),
  captureMethod: z.enum(["article", "selection", "url", "paste"]),
  adapterVersion: z.string().min(1).default("threads-web-v1"),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const PersonaSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    audience: z.string().min(1).max(500),
    voice: z.string().min(1).max(500),
    goals: z.array(z.string().min(1).max(200)).max(12).default([]),
    bannedPhrases: z.array(z.string().min(1).max(120)).max(50).default([]),
    preferredLength: z.object({
      min: z.number().int().min(20),
      max: z.number().int().max(5_000),
    }),
    language: z.string().min(2).default("ko-KR"),
  })
  .refine(
    (persona) => persona.preferredLength.min <= persona.preferredLength.max,
    {
      path: ["preferredLength", "max"],
      message: "Preferred maximum length must be at least the minimum length",
    },
  );
export type Persona = z.infer<typeof PersonaSchema>;

export const RiskFlagSchema = z.object({
  code: z.enum([
    "SOURCE_SIMILARITY",
    "CANDIDATE_DUPLICATION",
    "UNSUPPORTED_CLAIM",
    "BANNED_PHRASE",
    "AFFILIATE_DISCLOSURE_MISSING",
    "LENGTH_OUT_OF_RANGE",
    "POLICY_REVIEW",
    "THREADS_LIMIT_EXCEEDED",
    "INVALID_OUTPUT",
  ]),
  severity: z.enum(["info", "warning", "blocking"]),
  message: z.string().min(1),
  evidence: z.string().max(500).nullable().default(null),
  requiresReview: z.boolean().default(false),
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

const boundedScore = z.number().min(0).max(100);
export const QualityScoreSchema = z.object({
  hook: boundedScore,
  originality: boundedScore,
  readability: boundedScore,
  personaFit: boundedScore,
  evidence: boundedScore,
  cta: boundedScore,
  policy: boundedScore,
  total: boundedScore,
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const DraftCandidateSchema = z.object({
  id: z.string().min(1),
  hook: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().default(""),
  text: z.string().min(1),
  angle: z.string().min(1),
  rationale: z.string().min(1),
  score: QualityScoreSchema.nullable().default(null),
  riskFlags: z.array(RiskFlagSchema).default([]),
});
export type DraftCandidate = z.infer<typeof DraftCandidateSchema>;

export const FinalDraftSchema = z.object({
  id: z.string().min(1),
  generationId: z.string().min(1),
  selectedCandidateId: z.string().min(1),
  text: z.string().min(1),
  score: QualityScoreSchema,
  riskFlags: z.array(RiskFlagSchema),
  approvalStatus: z.enum(["DRAFT", "REVIEW_REQUIRED", "APPROVED"]),
  promptVersion: z.string().min(1),
  rubricVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable().default(null),
});
export type FinalDraft = z.infer<typeof FinalDraftSchema>;

export const GenerationRequestSchema = z.object({
  source: SourceSnapshotSchema,
  persona: PersonaSchema,
  purpose: z.string().min(1).max(1_000),
  mode: WritingModeSchema.default("new"),
  variationStrength: z.number().min(0).max(1).default(0.75),
  candidateCount: z.number().int().min(3).max(5).default(4),
  userEvidence: z.array(z.string().min(1).max(1_000)).max(20).default([]),
  affiliateDisclosure: z.string().max(300).nullable().default(null),
});
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

export const GenerationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state"),
    generationId: z.string(),
    state: GenerationStateSchema,
    at: z.string().datetime(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("delta"),
    generationId: z.string(),
    stage: GenerationStateSchema,
    delta: z.string(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("result"),
    generationId: z.string(),
    candidates: z.array(DraftCandidateSchema),
    finalDraft: FinalDraftSchema,
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("error"),
    generationId: z.string(),
    code: ApiErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    at: z.string().datetime(),
  }),
]);
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;

export const AuthStatusSchema = z.object({
  authenticated: z.boolean(),
  accountType: z.enum(["chatgpt", "apiKey", "amazonBedrock"]).nullable(),
  planType: z.string().nullable(),
  requiresOpenaiAuth: z.boolean(),
  rateLimits: z
    .object({
      primaryUsedPercent: z.number().nullable(),
      primaryResetsAt: z.number().nullable(),
      secondaryUsedPercent: z.number().nullable(),
      secondaryResetsAt: z.number().nullable(),
    })
    .nullable(),
  providerVersion: z.string().nullable(),
  providerMode: z.enum(["proxy", "direct"]).optional(),
  readinessReason: z.string().max(100).nullable().optional(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApprovedDraftSyncSchema = z
  .object({
    tenantId: z.string().min(1),
    workspaceId: z.string().min(1),
    threadsAccountId: z.string().min(1),
    draft: FinalDraftSchema.refine(
      (draft) =>
        draft.approvalStatus === "APPROVED" && draft.approvedAt !== null,
      {
        message: "Only timestamped approved drafts may be synchronized",
      },
    ),
    scheduledAt: z.string().datetime(),
    timezone: z.string().min(1),
    imageUrl: z.string().url().nullable().default(null),
    altText: z.string().max(1_000).nullable().default(null),
    mediaExpiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => countThreadsTextUnits(value.draft.text) <= 500, {
    message: "Threads text limit exceeded",
    path: ["draft", "text"],
  })
  .superRefine((value, context) => {
    if (value.imageUrl && !value.mediaExpiresAt) {
      context.addIssue({
        code: "custom",
        path: ["mediaExpiresAt"],
        message: "A managed image URL requires an expiry timestamp",
      });
      return;
    }
    if (
      value.mediaExpiresAt &&
      Date.parse(value.mediaExpiresAt) < Date.parse(value.scheduledAt) + 120_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["mediaExpiresAt"],
        message:
          "Media URL must remain valid for at least two minutes after schedule",
      });
    }
  });
export type ApprovedDraftSync = z.infer<typeof ApprovedDraftSyncSchema>;

export const PublishJobStateSchema = z.enum([
  "SCHEDULED",
  "LEASED",
  "PUBLISHING",
  "PUBLISHED",
  "RETRY_WAIT",
  "DEAD_LETTER",
  "CANCELED",
]);
export type PublishJobState = z.infer<typeof PublishJobStateSchema>;

export const WorkspaceContextSchema = z.object({
  tenantId: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "editor", "viewer"]),
});
export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>;

export function countThreadsTextUnits(text: string): number {
  const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
  let units = 0;
  for (const { segment } of segmenter.segment(text)) {
    units += /\p{Extended_Pictographic}/u.test(segment)
      ? new TextEncoder().encode(segment).length
      : [...segment].length;
  }
  return units;
}

export const RevisionRequestSchema = z
  .object({
    scope: z.enum(["hook", "cta", "full"]),
    feedback: z.string().trim().min(1).max(2_000),
    baseText: z
      .string()
      .min(1)
      .max(30_000)
      .refine((value) => value.trim().length > 0)
      .optional(),
    preview: z.boolean().default(false),
  })
  .refine((value) => !value.preview || value.baseText !== undefined, {
    message: "Preview requires the current editor text",
  });
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;
