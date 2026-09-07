import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  GenerationRequestSchema,
  RevisionRequestSchema,
  type AuthStatus,
} from "@threadflow-os/contracts";
import type { CodexProviderAdapter } from "@threadflow-os/codex-provider";
import { SessionTokens } from "@threadflow-os/shared";
import {
  GenerationManager,
  normalizeGenerationError,
  type GenerationProviderSession,
} from "./generation-manager.js";
import {
  reject,
  requestOrigin,
  validateHost,
  validateOrigin,
  verifyBootstrap,
  verifySession,
  type GatewaySecurity,
} from "./security.js";

export interface GatewayProvider {
  initialize(): Promise<void>;
  getAuthStatus(refreshToken?: boolean): Promise<AuthStatus>;
  login(
    type?: "chatgpt" | "chatgptDeviceCode",
  ): Promise<Record<string, unknown>>;
  cancelLogin(loginId: string): Promise<Record<string, unknown>>;
  logout(): Promise<void>;
  createGenerationProvider(): GenerationProviderSession;
  close(): Promise<void>;
}

export type GatewayConfig = {
  port: number;
  allowedOrigins: string[];
  bootstrapSecret: string;
  provider: GatewayProvider | CodexProviderAdapter;
};

export async function buildGateway(
  config: GatewayConfig,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024,
    requestTimeout: 130_000,
  });
  const security: GatewaySecurity = {
    allowedOrigins: new Set(config.allowedOrigins),
    bootstrapSecret: config.bootstrapSecret,
    sessions: new SessionTokens(config.bootstrapSecret, 15 * 60_000),
    port: config.port,
  };
  const manager = new GenerationManager(() =>
    config.provider.createGenerationProvider(),
  );

  await app.register(cors, {
    origin(origin, callback) {
      callback(
        null,
        typeof origin === "string" && security.allowedOrigins.has(origin),
      );
    },
    credentials: false,
    allowedHeaders: ["content-type", "authorization", "x-threadflow-bootstrap"],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!validateHost(request.headers.host, security.port))
      return reject(
        reply,
        421,
        "INVALID_HOST",
        "Gateway host가 허용되지 않았습니다.",
      );
    if (request.method === "OPTIONS") return;
    const origin = requestOrigin(request);
    if (!validateOrigin(origin, security.allowedOrigins))
      return reject(
        reply,
        403,
        "INVALID_ORIGIN",
        "허용되지 않은 클라이언트 Origin입니다.",
      );
  });

  app.get("/v1/health", async () => ({
    status: "ok",
    service: "threadflow-codex-gateway",
  }));

  app.post("/v1/session/bootstrap", async (request, reply) => {
    if (!verifyBootstrap(request, security))
      return reject(
        reply,
        401,
        "INVALID_BOOTSTRAP",
        "Companion 연결 키가 올바르지 않습니다.",
      );
    const origin = requestOrigin(request)!;
    return security.sessions.issue(origin);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (
      request.routeOptions.url === "/v1/health" ||
      request.routeOptions.url === "/v1/session/bootstrap"
    )
      return;
    if (!verifySession(request, security))
      return reject(
        reply,
        401,
        "INVALID_SESSION",
        "Gateway 세션이 없거나 만료되었습니다.",
      );
  });

  app.get("/v1/auth/status", async (request) => {
    const refresh = (request.query as { refresh?: string }).refresh === "true";
    return config.provider.getAuthStatus(refresh);
  });

  const login = async (request: any) => {
    const type =
      request.body?.type === "chatgptDeviceCode"
        ? "chatgptDeviceCode"
        : "chatgpt";
    return config.provider.login(type);
  };
  app.post("/v1/auth/login", login);
  app.post("/login", login);
  app.post("/v1/auth/login/cancel", async (request) => {
    const { loginId } = (request.body ?? {}) as { loginId?: unknown };
    if (typeof loginId !== "string" || !loginId.trim())
      throw new Error("INVALID_REQUEST: loginId is required");
    return config.provider.cancelLogin(loginId);
  });
  app.post("/v1/auth/logout", async () => {
    await config.provider.logout();
    return { ok: true };
  });
  app.post("/logout", async () => {
    await config.provider.logout();
    return { ok: true };
  });

  app.post("/v1/generations", async (request, reply) => {
    const parsed = GenerationRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reject(
        reply,
        400,
        "INVALID_REQUEST",
        "생성 요청 형식이 올바르지 않습니다.",
      );
    const auth = await config.provider.getAuthStatus();
    if (!auth.authenticated)
      return reject(reply, 401, "AUTH_REQUIRED", "Codex 로그인이 필요합니다.");
    return reply.code(202).send(manager.create(parsed.data));
  });

  app.get("/v1/generations/:id", async (request, reply) => {
    const snapshot = manager.get((request.params as { id: string }).id);
    return (
      snapshot ??
      reject(reply, 404, "NOT_FOUND", "생성 작업을 찾을 수 없습니다.")
    );
  });

  app.get("/v1/generations/:id/events", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const existing = manager.events(id);
    if (!existing)
      return reject(reply, 404, "NOT_FOUND", "생성 작업을 찾을 수 없습니다.");
    const origin = requestOrigin(request)!;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      vary: "Origin",
      "access-control-allow-origin": origin,
      "x-accel-buffering": "no",
    });
    let cursor = 0;
    for (const event of existing) {
      reply.raw.write(`id: ${cursor++}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    const lastState = [...existing]
      .reverse()
      .find((event) => event.type === "state");
    if (
      lastState?.type === "state" &&
      ["COMPLETED", "FAILED", "CANCELED"].includes(lastState.state)
    ) {
      reply.raw.end();
      return;
    }
    const unsubscribe = manager.subscribe(id, (event) => {
      reply.raw.write(`id: ${cursor++}\ndata: ${JSON.stringify(event)}\n\n`);
      if (
        event.type === "state" &&
        ["COMPLETED", "FAILED", "CANCELED"].includes(event.state)
      ) {
        unsubscribe?.();
        reply.raw.end();
      }
    });
    request.raw.once("close", () => unsubscribe?.());
  });

  app.post("/v1/generations/:id/cancel", async (request, reply) => {
    const canceled = await manager.cancel(
      (request.params as { id: string }).id,
    );
    return canceled
      ? { ok: true }
      : reject(reply, 409, "NOT_CANCELABLE", "취소할 수 없는 작업입니다.");
  });

  app.post("/v1/generations/:id/revisions", async (request, reply) => {
    const parsed = RevisionRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reject(
        reply,
        400,
        "INVALID_REQUEST",
        "수정 범위·피드백·기준 본문을 확인하세요.",
      );
    const body = parsed.data;
    try {
      const auth = await config.provider.getAuthStatus();
      if (!auth.authenticated)
        return reject(
          reply,
          401,
          "AUTH_REQUIRED",
          "Codex 로그인이 필요합니다.",
        );
      return await manager.revise((request.params as { id: string }).id, body);
    } catch (error) {
      if (error instanceof Error && error.message === "REVISION_BUSY")
        return reject(
          reply,
          409,
          "REVISION_BUSY",
          "수정 작업이 이미 진행 중입니다.",
        );
      if (error instanceof Error && error.message === "NOT_REVISION_READY")
        return reject(
          reply,
          409,
          "NOT_REVISION_READY",
          "수정할 생성 문맥이 없거나 만료됐습니다. 현재 글을 보존하고 새로 생성해 주세요.",
        );
      throw error;
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "요청 본문이 허용 크기를 초과했습니다.",
          retryable: false,
        },
      });
    }
    const normalized = normalizeGenerationError(error);
    const status =
      normalized.code === "AUTH_REQUIRED"
        ? 401
        : normalized.code === "RATE_LIMITED"
          ? 429
          : normalized.code === "PROVIDER_UNAVAILABLE"
            ? 503
            : normalized.code === "INVALID_OUTPUT"
              ? 502
              : 500;
    return reply.code(status).send({ error: normalized });
  });

  app.addHook("onClose", async () => config.provider.close());
  return app;
}
