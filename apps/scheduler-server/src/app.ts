import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  ApprovedDraftSyncSchema,
  WritingModeSchema,
  WorkspaceContextSchema,
  type WorkspaceContext,
} from "@threadflow-os/contracts";
import { type ThreadFlowRepository } from "@threadflow-os/database";
import { constantTimeEqual, createId, sha256 } from "@threadflow-os/shared";
import type { AesGcmVault } from "@threadflow-os/shared";
import {
  createOAuthState,
  createPkce,
  ThreadsApiError,
  type ThreadsApiClient,
} from "@threadflow-os/threads-client";
import { InsightsCollector } from "./insights-collector.js";

export type SchedulerConfig = {
  repository: ThreadFlowRepository;
  threadsClient: ThreadsApiClient;
  vault: AesGcmVault;
  accessKeys: Map<string, WorkspaceContext>;
  maxImageBytes?: number;
  mediaUrlTtlMs?: number;
  oauthRedirectUri?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    workspaceContext?: WorkspaceContext;
  }
}

export async function buildScheduler(
  config: SchedulerConfig,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });
  const insights = new InsightsCollector({
    repository: config.repository,
    client: config.threadsClient,
    vault: config.vault,
  });

  app.get("/v1/health", async () => ({
    status: "ok",
    systemPaused: config.repository.isPaused("global", "all"),
  }));

  app.addHook("preHandler", async (request, reply) => {
    if (
      request.routeOptions.url === "/v1/health" ||
      request.routeOptions.url === "/v1/threads/oauth/callback"
    )
      return;
    const context = authenticate(request, config.accessKeys);
    if (!context)
      return reply.code(401).send({
        error: {
          code: "AUTH_REQUIRED",
          message: "사용자별 API 인증이 필요합니다.",
        },
      });
    request.workspaceContext = context;
  });

  app.post("/v1/threads/oauth/start", async (request, reply) => {
    const context = request.workspaceContext!;
    config.repository.assertMembership(context, "editor");
    const state = createOAuthState();
    const { verifier, challenge } = createPkce();
    const callbackUri =
      config.oauthRedirectUri ?? config.threadsClient.redirectUri;
    const stateHash = sha256(state);
    config.repository.createOAuthState({
      stateHash,
      context,
      verifierCiphertext: config.vault.encrypt(verifier, `oauth:${stateHash}`),
      redirectUri: callbackUri,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    return reply.send({
      authUrl: config.threadsClient.createAuthorization(state, challenge),
      expiresInSeconds: 600,
    });
  });

  app.get("/v1/threads/oauth/callback", async (request, reply) => {
    const { state, code, error } = request.query as {
      state?: string;
      code?: string;
      error?: string;
    };
    if (error)
      return reply
        .code(400)
        .type("text/plain")
        .send("Threads 연결이 취소되었습니다. 이 창을 닫아도 됩니다.");
    if (!state || !code)
      return reply.code(400).send({
        error: {
          code: "INVALID_CALLBACK",
          message: "state와 code가 필요합니다.",
        },
      });
    const stateHash = sha256(state);
    const pending = config.repository.consumeOAuthState(stateHash);
    if (!pending)
      return reply.code(400).send({
        error: {
          code: "INVALID_STATE",
          message: "만료되었거나 이미 사용된 OAuth state입니다.",
        },
      });
    const verifier = config.vault.decrypt(
      pending.verifierCiphertext,
      `oauth:${stateHash}`,
    );
    const shortLived = await config.threadsClient.exchangeCode(code, verifier);
    const token = await config.threadsClient.exchangeLongLivedToken(
      shortLived.access_token,
    );
    if (!token.access_token || !token.expires_in || token.expires_in <= 0)
      throw new ThreadsApiError(
        "Threads did not return a valid long-lived user token",
        502,
        "INVALID_LONG_LIVED_TOKEN",
        false,
      );
    const profile = await config.threadsClient.getProfile(token.access_token);
    const existing = config.repository.getThreadsAccountByThreadsUserId(
      pending.context,
      String(profile.id),
    );
    const accountId = existing?.id ?? createId("threads_account");
    const storedAccountId = config.repository.upsertThreadsAccount(
      pending.context,
      {
        id: accountId,
        threadsUserId: String(profile.id),
        username: profile.username ?? null,
        tokenCiphertext: config.vault.encrypt(
          token.access_token,
          `${pending.context.tenantId}:${accountId}`,
        ),
        tokenExpiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1_000).toISOString()
          : null,
      },
    );
    if (storedAccountId !== accountId)
      throw new Error("THREADS_ACCOUNT_ID_MISMATCH");
    config.repository.setPaused("account", storedAccountId, false);
    return reply
      .type("text/html; charset=utf-8")
      .send(
        '<!doctype html><html lang="ko"><meta charset="utf-8"><title>ThreadFlow OS</title><body><h1>Threads 연결 완료</h1><p>이 창을 닫고 ThreadFlow OS로 돌아가세요.</p></body></html>',
      );
  });

  app.get("/v1/threads/accounts", async (request) => {
    return config.repository
      .listThreadsAccounts(request.workspaceContext!)
      .map((account) => ({
        id: account.id,
        threadsUserId: account.threadsUserId,
        username: account.username,
        tokenExpiresAt: account.tokenExpiresAt,
        paused:
          account.paused || config.repository.isPaused("account", account.id),
        disconnectedAt: account.disconnectedAt,
      }));
  });

  app.delete("/v1/threads/accounts/:id", async (request) => {
    config.repository.disconnectThreadsAccount(
      request.workspaceContext!,
      (request.params as { id: string }).id,
    );
    return { ok: true };
  });

  app.post("/v1/drafts/:id/versions", async (request, reply) => {
    const context = request.workspaceContext!;
    const body = (request.body ?? {}) as {
      draft?: unknown;
      parentVersion?: number;
    };
    const syncDraft = ApprovedDraftSyncSchema.shape.draft.safeParse(body.draft);
    if (!syncDraft.success)
      return reply.code(400).send({
        error: {
          code: "INVALID_DRAFT",
          message: "승인된 Final Draft만 저장할 수 있습니다.",
        },
      });
    if (syncDraft.data.id !== (request.params as { id: string }).id)
      return reply.code(400).send({
        error: {
          code: "DRAFT_ID_MISMATCH",
          message: "경로와 승인 Draft ID가 일치해야 합니다.",
        },
      });
    const version = config.repository.saveDraftVersion(
      context,
      syncDraft.data,
      body.parentVersion,
    );
    return reply.code(201).send({ draftId: syncDraft.data.id, version });
  });

  app.get("/v1/drafts/:id/versions", async (request) => {
    return config.repository.listDraftVersions(
      request.workspaceContext!,
      (request.params as { id: string }).id,
    );
  });

  app.post("/v1/publish-jobs", async (request, reply) => {
    const context = request.workspaceContext!;
    const body = (request.body ?? {}) as {
      sync?: unknown;
      accountId?: string;
      draftVersion?: number;
      idempotencyKey?: string;
    };
    const sync = ApprovedDraftSyncSchema.safeParse(body.sync);
    if (!sync.success)
      return reply.code(400).send({
        error: {
          code: "INVALID_DRAFT",
          message: "승인·예약 데이터가 올바르지 않습니다.",
        },
      });
    if (
      typeof body.accountId !== "string" ||
      !body.accountId ||
      sync.data.threadsAccountId !== body.accountId ||
      !Number.isInteger(body.draftVersion) ||
      body.draftVersion! < 1 ||
      typeof body.idempotencyKey !== "string" ||
      body.idempotencyKey.length < 8 ||
      body.idempotencyKey.length > 200
    )
      return reply.code(400).send({
        error: {
          code: "INVALID_PUBLISH_REQUEST",
          message:
            "계정, Draft 버전, Idempotency Key가 승인 데이터와 일치해야 합니다.",
        },
      });
    if (Date.parse(sync.data.scheduledAt) < Date.now() - 30_000) {
      return reply.code(400).send({
        error: {
          code: "PAST_SCHEDULE",
          message: "과거 시각으로 예약할 수 없습니다.",
        },
      });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: sync.data.timezone }).format();
    } catch {
      return reply.code(400).send({
        error: {
          code: "INVALID_TIMEZONE",
          message: "유효한 IANA 시간대가 필요합니다.",
        },
      });
    }
    const job = config.repository.createPublishJob(
      context,
      sync.data,
      body.accountId,
      body.draftVersion!,
      body.idempotencyKey,
    );
    return reply.code(201).send(job);
  });

  app.get("/v1/publish-jobs/:id", async (request, reply) => {
    const job = config.repository.getJob(
      request.workspaceContext!,
      (request.params as { id: string }).id,
    );
    return (
      job ??
      reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "게시 작업을 찾을 수 없습니다.",
        },
      })
    );
  });

  app.get("/v1/publish-jobs", async (request) => {
    return config.repository.listPublishJobs(request.workspaceContext!);
  });

  app.post("/v1/publish-jobs/:id/cancel", async (request) => {
    return config.repository.cancelPublishJob(
      request.workspaceContext!,
      (request.params as { id: string }).id,
    );
  });

  app.post("/v1/publish-jobs/:id/insights/refresh", async (request) => {
    const jobId = (request.params as { id: string }).id;
    const result = await insights.collect(request.workspaceContext!, jobId);
    return { jobId, ...result };
  });

  app.get("/v1/publish-jobs/:id/insights", async (request) => {
    return config.repository.listInsights(
      request.workspaceContext!,
      (request.params as { id: string }).id,
    );
  });

  app.post("/v1/controls/global", async (request, reply) => {
    const context = request.workspaceContext!;
    config.repository.assertMembership(context, "owner");
    const paused = parsePaused(request.body);
    if (paused === null)
      return reply.code(400).send({
        error: {
          code: "INVALID_PAUSE_VALUE",
          message: "paused는 true 또는 false여야 합니다.",
        },
      });
    config.repository.setPaused("global", workspaceControlId(context), paused);
    return { paused };
  });

  app.get("/v1/controls", async (request) => {
    const context = request.workspaceContext!;
    config.repository.assertMembership(context);
    return {
      workspacePaused: config.repository.isPaused(
        "global",
        workspaceControlId(context),
      ),
      systemPaused: config.repository.isPaused("global", "all"),
    };
  });

  app.post("/v1/controls/accounts/:id", async (request, reply) => {
    const context = request.workspaceContext!;
    config.repository.assertMembership(context, "editor");
    const id = (request.params as { id: string }).id;
    if (!config.repository.getThreadsAccount(context, id))
      throw new Error("NOT_FOUND");
    const paused = parsePaused(request.body);
    if (paused === null)
      return reply.code(400).send({
        error: {
          code: "INVALID_PAUSE_VALUE",
          message: "paused는 true 또는 false여야 합니다.",
        },
      });
    config.repository.setPaused("account", id, paused);
    return { paused };
  });

  app.post("/v1/prompts/:mode/activate", async (request, reply) => {
    const context = request.workspaceContext!;
    const mode = WritingModeSchema.safeParse(
      (request.params as { mode?: unknown }).mode,
    );
    const version = (request.body as { version?: unknown } | null)?.version;
    if (
      !mode.success ||
      typeof version !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
    )
      return reply.code(400).send({
        error: {
          code: "INVALID_PROMPT_VERSION",
          message: "지원 모드와 SemVer 형식의 버전이 필요합니다.",
        },
      });
    config.repository.setPromptVersion(context, mode.data, version);
    return { activeVersion: version };
  });

  app.post("/v1/prompts/:mode/rollback", async (request, reply) => {
    const mode = WritingModeSchema.safeParse(
      (request.params as { mode?: unknown }).mode,
    );
    if (!mode.success)
      return reply.code(400).send({
        error: {
          code: "INVALID_PROMPT_MODE",
          message: "지원되는 작성 모드가 필요합니다.",
        },
      });
    return {
      activeVersion: config.repository.rollbackPromptVersion(
        request.workspaceContext!,
        mode.data,
      ),
    };
  });

  app.delete("/v1/users/me/data", async (request) => {
    config.repository.deleteUserData(request.workspaceContext!);
    return { deleted: true };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ThreadsApiError) {
      const status =
        error.status === 429
          ? 429
          : error.status >= 500 && error.retryable
            ? 503
            : 502;
      return reply.code(status).send({
        error: {
          code: error.code,
          message: "Threads API 요청을 처리할 수 없습니다.",
        },
      });
    }
    const message = error instanceof Error ? error.message : "INTERNAL";
    const status = /FORBIDDEN/.test(message)
      ? 403
      : /NOT_FOUND/.test(message)
        ? 404
        : /UNIQUE|constraint|DUPLICATE|VERSION_CONFLICT|JOB_NOT_CANCELABLE|NO_ROLLBACK_VERSION|ACCOUNT_UNAVAILABLE/.test(
              message,
            )
          ? 409
          : /INVALID_|ACCOUNT_UNAVAILABLE/.test(message)
            ? 400
            : 500;
    const code = schedulerErrorCode(message, status);
    reply.code(status).send({
      error: {
        code,
        message: schedulerErrorMessage(code),
      },
    });
  });
  return app;
}

function authenticate(
  request: FastifyRequest,
  accessKeys: Map<string, WorkspaceContext>,
): WorkspaceContext | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const supplied = header.slice(7);
  for (const [key, context] of accessKeys) {
    if (constantTimeEqual(key, supplied))
      return WorkspaceContextSchema.parse(context);
  }
  return null;
}

function parsePaused(body: unknown): boolean | null {
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { paused?: unknown }).paused !== "boolean"
  )
    return null;
  return (body as { paused: boolean }).paused;
}

function workspaceControlId(context: WorkspaceContext): string {
  return `${context.tenantId}:${context.workspaceId}`;
}

function schedulerErrorCode(message: string, status: number): string {
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (/JOB_NOT_CANCELABLE/.test(message)) return "JOB_NOT_CANCELABLE";
  if (/VERSION_CONFLICT/.test(message)) return "VERSION_CONFLICT";
  if (/NO_ROLLBACK_VERSION/.test(message)) return "NO_ROLLBACK_VERSION";
  if (/ACCOUNT_UNAVAILABLE/.test(message)) return "ACCOUNT_UNAVAILABLE";
  if (status === 409) return "DUPLICATE";
  if (status === 400) return "INVALID_REQUEST";
  return "INTERNAL";
}

function schedulerErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    FORBIDDEN: "이 작업을 수행할 권한이 없습니다.",
    NOT_FOUND: "요청한 대상을 찾을 수 없습니다.",
    JOB_NOT_CANCELABLE: "이미 게시가 시작된 작업은 취소할 수 없습니다.",
    VERSION_CONFLICT: "Draft가 변경되었습니다. 최신 버전을 다시 확인하세요.",
    NO_ROLLBACK_VERSION: "되돌릴 이전 Prompt 버전이 없습니다.",
    ACCOUNT_UNAVAILABLE: "Threads 계정이 연결 해제되었거나 사용할 수 없습니다.",
    DUPLICATE: "같은 내용의 활성 작업이 이미 존재합니다.",
    INVALID_REQUEST: "입력값을 확인하세요.",
    INTERNAL: "요청 처리 중 오류가 발생했습니다.",
  };
  return messages[code] ?? messages.INTERNAL!;
}
