import { EventEmitter } from "node:events";
import {
  GenerationRequestSchema,
  type RevisionRequest,
  type ApiErrorCode,
  type GenerationEvent,
  type GenerationRequest,
  type GenerationState,
} from "@threadflow-os/contracts";
import {
  QualityPipeline,
  deterministicFlags,
  type PipelineResult,
  type StructuredTextProvider,
} from "@threadflow-os/quality-engine";
import { buildRevisionPrompt } from "@threadflow-os/prompt-kit";
import { createId, nowIso } from "@threadflow-os/shared";
import { generationRequestFingerprint } from "@threadflow-os/shared/fingerprint";
import { assertProviderOutputSafe } from "@threadflow-os/shared/runtime-security";

export type GenerationProviderSession = StructuredTextProvider & {
  close(): Promise<void>;
  threadId(): string | null;
};
export type GenerationSnapshot = {
  id: string;
  state: GenerationState;
  createdAt: string;
  updatedAt: string;
  result: PipelineResult | null;
  error: { code: ApiErrorCode; message: string; retryable: boolean } | null;
  providerThreadId: string | null;
  requestFingerprint: string;
};

type Job = GenerationSnapshot & {
  request: GenerationRequest;
  abort: AbortController;
  events: GenerationEvent[];
  bus: EventEmitter;
  provider: GenerationProviderSession;
  revisionBusy?: boolean;
};

export class GenerationManager {
  readonly #jobs = new Map<string, Job>();
  readonly #idempotency = new Map<
    string,
    { fingerprint: string; jobId: string; expiresAt: number }
  >();
  readonly #activeFingerprints = new Map<string, string>();

  constructor(
    private readonly createProvider: () => GenerationProviderSession,
    private readonly idempotencyTtlMs = 10 * 60_000,
  ) {}

  create(
    input: unknown,
    identity: { idempotencyKey: string; requestFingerprint: string },
  ): GenerationSnapshot {
    const request = GenerationRequestSchema.parse(input);
    const fingerprint = generationRequestFingerprint(request);
    if (identity.requestFingerprint !== fingerprint)
      throw new Error("IDEMPOTENCY_CONFLICT");
    this.cleanupIdempotency();
    const keyed = this.#idempotency.get(identity.idempotencyKey);
    if (keyed) {
      if (keyed.fingerprint !== fingerprint)
        throw new Error("IDEMPOTENCY_CONFLICT");
      const existing = this.#jobs.get(keyed.jobId);
      if (existing) return this.snapshot(existing);
      this.#idempotency.delete(identity.idempotencyKey);
    }
    const activeId = this.#activeFingerprints.get(fingerprint);
    const active = activeId ? this.#jobs.get(activeId) : undefined;
    if (active && !isTerminal(active.state)) {
      this.#idempotency.set(identity.idempotencyKey, {
        fingerprint,
        jobId: active.id,
        expiresAt: Date.now() + this.idempotencyTtlMs,
      });
      return this.snapshot(active);
    }
    if (activeId) this.#activeFingerprints.delete(fingerprint);
    const id = createId("generation");
    const provider = guardProviderOutput(this.createProvider());
    const now = nowIso();
    const job: Job = {
      id,
      request,
      state: "QUEUED",
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
      providerThreadId: null,
      requestFingerprint: fingerprint,
      abort: new AbortController(),
      events: [],
      bus: new EventEmitter(),
      provider,
    };
    this.#jobs.set(id, job);
    this.#activeFingerprints.set(fingerprint, id);
    this.#idempotency.set(identity.idempotencyKey, {
      fingerprint,
      jobId: id,
      expiresAt: Date.now() + this.idempotencyTtlMs,
    });
    this.emit(job, {
      type: "state",
      generationId: id,
      state: "QUEUED",
      at: now,
    });
    queueMicrotask(() => void this.run(job));
    return this.snapshot(job);
  }

  get(id: string): GenerationSnapshot | null {
    const job = this.#jobs.get(id);
    return job ? this.snapshot(job) : null;
  }

  events(id: string, after = 0): GenerationEvent[] | null {
    const job = this.#jobs.get(id);
    return job ? job.events.slice(after) : null;
  }

  subscribe(
    id: string,
    listener: (event: GenerationEvent) => void,
  ): (() => void) | null {
    const job = this.#jobs.get(id);
    if (!job) return null;
    job.bus.on("event", listener);
    return () => job.bus.off("event", listener);
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.#jobs.get(id);
    if (!job || ["COMPLETED", "FAILED", "CANCELED"].includes(job.state))
      return false;
    job.abort.abort();
    await job.provider.close().catch(() => undefined);
    this.emit(job, {
      type: "state",
      generationId: id,
      state: "CANCELED",
      at: nowIso(),
    });
    return true;
  }

  async revise(id: string, input: RevisionRequest): Promise<PipelineResult> {
    const job = this.#jobs.get(id);
    const threadId = job?.provider.threadId();
    if (
      !job?.result ||
      job.state !== "COMPLETED" ||
      !threadId ||
      !job.provider.revise
    )
      throw new Error("NOT_REVISION_READY");
    if (job.revisionBusy) throw new Error("REVISION_BUSY");
    job.revisionBusy = true;
    try {
      const output = (await job.provider.revise(
        threadId,
        buildRevisionPrompt(
          input.baseText ?? job.result.finalDraft.text,
          input.feedback,
          input.scope,
        ),
        {
          type: "object",
          additionalProperties: false,
          required: ["text"],
          properties: { text: { type: "string" } },
        },
        job.abort.signal,
      )) as { text?: unknown };
      if (
        typeof output.text !== "string" ||
        !output.text.trim() ||
        output.text.length > 30_000
      )
        throw new Error("INVALID_OUTPUT");
      const flags = deterministicFlags(job.request, output.text);
      const result: PipelineResult = {
        ...job.result,
        finalDraft: {
          ...job.result.finalDraft,
          text: output.text,
          riskFlags: flags,
          approvalStatus: flags.some((flag) => flag.severity === "blocking")
            ? "REVIEW_REQUIRED"
            : "DRAFT",
          approvedAt: null,
        },
      };
      if (!input.preview) {
        job.result = result;
        job.updatedAt = nowIso();
      }
      return result;
    } finally {
      job.revisionBusy = false;
    }
  }

  private async run(job: Job): Promise<void> {
    try {
      const result = await new QualityPipeline(job.provider).run(
        job.id,
        job.request,
        (event) => this.emit(job, event),
        job.abort.signal,
      );
      job.result = result;
      job.providerThreadId = job.provider.threadId();
    } catch (error) {
      if (job.abort.signal.aborted) {
        if (job.state !== "CANCELED")
          this.emit(job, {
            type: "state",
            generationId: job.id,
            state: "CANCELED",
            at: nowIso(),
          });
        return;
      }
      const normalized = normalizeGenerationError(error);
      job.error = normalized;
      this.emit(job, {
        type: "error",
        generationId: job.id,
        ...normalized,
        at: nowIso(),
      });
      this.emit(job, {
        type: "state",
        generationId: job.id,
        state: "FAILED",
        at: nowIso(),
      });
    }
  }

  private emit(job: Job, event: GenerationEvent): void {
    job.events.push(event);
    job.updatedAt = event.at;
    if (event.type === "state") job.state = event.state;
    if (event.type === "state" && isTerminal(event.state)) {
      if (this.#activeFingerprints.get(job.requestFingerprint) === job.id)
        this.#activeFingerprints.delete(job.requestFingerprint);
    }
    if (event.type === "result") {
      job.result = {
        candidates: event.candidates,
        finalDraft: event.finalDraft,
      };
    }
    job.bus.emit("event", event);
  }

  private snapshot(job: Job): GenerationSnapshot {
    return {
      id: job.id,
      state: job.state,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      result: job.result,
      error: job.error,
      providerThreadId: job.providerThreadId,
      requestFingerprint: job.requestFingerprint,
    };
  }

  private cleanupIdempotency(): void {
    const now = Date.now();
    for (const [key, entry] of this.#idempotency) {
      if (entry.expiresAt <= now) this.#idempotency.delete(key);
    }
  }
}

function isTerminal(state: GenerationState): boolean {
  return ["COMPLETED", "FAILED", "CANCELED"].includes(state);
}

export function normalizeGenerationError(error: unknown): {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
} {
  const message =
    error instanceof Error ? error.message : "Unknown generation error";
  if (/AUTH_REQUIRED|not logged in|401/i.test(message))
    return {
      code: "AUTH_REQUIRED",
      message: "Codex 로그인이 필요합니다.",
      retryable: false,
    };
  if (/RATE_LIMIT|429/i.test(message))
    return {
      code: "RATE_LIMITED",
      message: "Codex 서비스 사용량이 일시적으로 제한되었습니다.",
      retryable: true,
    };
  if (/Abort|canceled|cancelled/i.test(message))
    return {
      code: "CANCELED",
      message: "생성이 취소되었습니다.",
      retryable: false,
    };
  if (/SENSITIVE_PROVIDER_OUTPUT/i.test(message))
    return {
      code: "SENSITIVE_PROVIDER_OUTPUT",
      message: "Provider 응답에 민감 정보가 포함되어 결과를 차단했습니다.",
      retryable: true,
    };
  if (/timed out|exited|unavailable|ECONN|ENOENT|App Server/i.test(message))
    return {
      code: "PROVIDER_UNAVAILABLE",
      message: "Codex Provider에 연결할 수 없습니다.",
      retryable: true,
    };
  if (/INVALID_OUTPUT|schema|JSON/i.test(message))
    return {
      code: "INVALID_OUTPUT",
      message: "구조화 출력 검증에 실패했습니다.",
      retryable: true,
    };
  if (/IDEMPOTENCY_CONFLICT/i.test(message))
    return {
      code: "IDEMPOTENCY_CONFLICT",
      message: "멱등성 키와 생성 요청이 일치하지 않습니다.",
      retryable: false,
    };
  return {
    code: "INTERNAL",
    message: "생성 처리 중 오류가 발생했습니다.",
    retryable: false,
  };
}

function guardProviderOutput(
  provider: GenerationProviderSession,
): GenerationProviderSession {
  return {
    threadId: () => provider.threadId(),
    close: () => provider.close(),
    async generateJson(call) {
      // Raw model deltas are withheld until the complete structured value has
      // passed DLP. Stage events still provide deterministic progress.
      const bufferedDeltas: string[] = [];
      const { onDelta, ...safeCall } = call;
      const output = await provider.generateJson({
        ...safeCall,
        onDelta: (delta) => bufferedDeltas.push(delta),
      });
      assertProviderOutputSafe(output);
      assertProviderOutputSafe(bufferedDeltas.join(""));
      for (const delta of bufferedDeltas) onDelta?.(delta);
      return output;
    },
    ...(provider.revise
      ? {
          async revise(
            threadId: string,
            prompt: string,
            schema: Record<string, unknown>,
            signal?: AbortSignal,
          ) {
            const output = await provider.revise!(
              threadId,
              prompt,
              schema,
              signal,
            );
            assertProviderOutputSafe(output);
            return output;
          },
        }
      : {}),
  };
}
