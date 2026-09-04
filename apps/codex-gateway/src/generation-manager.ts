import { EventEmitter } from "node:events";
import {
  GenerationRequestSchema,
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
};

type Job = GenerationSnapshot & {
  request: GenerationRequest;
  abort: AbortController;
  events: GenerationEvent[];
  bus: EventEmitter;
  provider: GenerationProviderSession;
};

export class GenerationManager {
  readonly #jobs = new Map<string, Job>();

  constructor(
    private readonly createProvider: () => GenerationProviderSession,
  ) {}

  create(input: unknown): GenerationSnapshot {
    const request = GenerationRequestSchema.parse(input);
    const id = createId("generation");
    const provider = this.createProvider();
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
      abort: new AbortController(),
      events: [],
      bus: new EventEmitter(),
      provider,
    };
    this.#jobs.set(id, job);
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

  async revise(
    id: string,
    input: { feedback: string; scope: "hook" | "cta" | "full" },
  ): Promise<PipelineResult> {
    const job = this.#jobs.get(id);
    const threadId = job?.provider.threadId();
    if (!job?.result || !threadId || !job.provider.revise)
      throw new Error("NOT_REVISION_READY");
    const output = (await job.provider.revise(
      threadId,
      buildRevisionPrompt(
        job.result.finalDraft.text,
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
    if (typeof output.text !== "string" || !output.text.trim())
      throw new Error("INVALID_OUTPUT");
    const flags = deterministicFlags(job.request, output.text);
    job.result = {
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
    job.updatedAt = nowIso();
    return job.result;
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
    };
  }
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
  return {
    code: "INTERNAL",
    message: "생성 처리 중 오류가 발생했습니다.",
    retryable: false,
  };
}
