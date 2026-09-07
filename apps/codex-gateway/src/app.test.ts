import { describe, expect, it } from "vitest";
import type { AuthStatus, GenerationRequest } from "@threadflow-os/contracts";
import { generationRequestFingerprint } from "@threadflow-os/shared/fingerprint";
import type { GenerationProviderSession } from "./generation-manager.js";
import { buildGateway, type GatewayProvider } from "./app.js";

const origin = "chrome-extension://threadflow-test";
const port = 8787;
const headers = { host: `127.0.0.1:${port}`, origin };

function generationPayload(
  sourceId = "s",
  purpose = "테스트",
): GenerationRequest {
  return {
    source: {
      id: sourceId,
      text: sourceId === "s-cancel" ? "취소 테스트 참고 글" : "참고 글",
      author: null,
      url: null,
      capturedAt: new Date().toISOString(),
      captureMethod: "paste",
      adapterVersion: "threads-web-v1",
    },
    persona: {
      id: "p",
      name: "p",
      audience: "a",
      voice: "v",
      goals: [],
      bannedPhrases: [],
      preferredLength: { min: 20, max: 500 },
      language: "ko-KR",
    },
    purpose,
    mode: "new",
    variationStrength: 0.8,
    candidateCount: 3,
    userEvidence: [],
    affiliateDisclosure: null,
  };
}

function generationHeaders(
  authorized: Record<string, string>,
  payload: GenerationRequest,
  key = "threadflow-test-key-0001",
) {
  return {
    ...authorized,
    "idempotency-key": key,
    "x-request-fingerprint": generationRequestFingerprint(payload),
  };
}

class FakeProvider implements GatewayProvider {
  closed = false;
  authenticated = true;
  generationSessions = 0;
  sensitiveOutput = false;
  revisionPrompts: string[] = [];
  revisionResult: () => Promise<unknown> = async () => ({
    text: "수정된 최종 글입니다.",
  });

  constructor(private readonly blockGeneration = false) {}
  async initialize() {}
  async getAuthStatus(): Promise<AuthStatus> {
    return {
      authenticated: this.authenticated,
      accountType: this.authenticated ? "chatgpt" : null,
      planType: this.authenticated ? "pro" : null,
      requiresOpenaiAuth: true,
      rateLimits: null,
      providerVersion: "0.145.0",
    };
  }
  async login() {
    return {
      type: "chatgpt",
      loginId: "login-1",
      authUrl: "https://auth.openai.com/",
    };
  }
  async cancelLogin(loginId: string) {
    return { status: loginId ? "canceled" : "notFound" };
  }
  async logout() {
    this.authenticated = false;
  }
  createGenerationProvider(): GenerationProviderSession {
    this.generationSessions += 1;
    if (this.blockGeneration) {
      return {
        threadId: () => "thread-blocked",
        close: async () => undefined,
        generateJson: async ({ signal }) =>
          new Promise((_, reject) => {
            const cancel = () =>
              reject(new DOMException("Generation canceled", "AbortError"));
            if (signal?.aborted) cancel();
            else signal?.addEventListener("abort", cancel, { once: true });
          }),
      };
    }
    return {
      threadId: () => "thread-1",
      close: async () => undefined,
      revise: async (_thread, prompt) => {
        this.revisionPrompts.push(prompt);
        return this.revisionResult();
      },
      generateJson: async ({ stage, onDelta }) => {
        if (this.sensitiveOutput) {
          const leaked = `Bearer ${"s".repeat(24)}`;
          onDelta?.(leaked);
          return {
            hookPattern: leaked,
            structure: [],
            emotion: [],
            ctaPattern: "질문",
            claimRisks: [],
            doNotReuse: [],
          };
        }
        if (stage === "ANALYZING")
          return {
            hookPattern: "질문",
            structure: [],
            emotion: [],
            ctaPattern: "질문",
            claimRisks: [],
            doNotReuse: [],
          };
        if (stage === "STRATEGIZING")
          return {
            angles: ["a", "b", "c"],
            voiceRules: [],
            evidenceRules: [],
            differentiationRules: [],
          };
        if (stage === "GENERATING")
          return {
            candidates: [
              {
                hook: "A",
                body: "새로운 설명 A",
                cta: "",
                angle: "a",
                rationale: "a",
              },
              {
                hook: "B",
                body: "다른 설명 B",
                cta: "",
                angle: "b",
                rationale: "b",
              },
              {
                hook: "C",
                body: "별도 설명 C",
                cta: "",
                angle: "c",
                rationale: "c",
              },
            ],
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
        if (stage === "CRITIQUING")
          return {
            ranked: [0, 1, 2].map((candidateIndex) => ({
              candidateIndex,
              score,
              strengths: [],
              weaknesses: [],
            })),
          };
        return {
          selectedCandidateIndex: 0,
          text: "새로운 최종 글입니다.",
          score,
        };
      },
    };
  }
  async close() {
    this.closed = true;
  }
}

async function setup(blockGeneration = false) {
  const provider = new FakeProvider(blockGeneration);
  const app = await buildGateway({
    port,
    allowedOrigins: [origin],
    bootstrapSecret: "bootstrap",
    provider,
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/session/bootstrap",
    headers: { ...headers, "x-threadflow-bootstrap": "bootstrap" },
  });
  const session = response.json<{ token: string }>().token;
  return {
    app,
    provider,
    authorized: { ...headers, authorization: `Bearer ${session}` },
  };
}

describe("localhost gateway security", () => {
  it("rejects malicious origins, hosts, sessions, and oversized payloads", async () => {
    const { app, authorized } = await setup();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/health",
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/health",
          headers: { ...headers, host: "attacker.example" },
        })
      ).statusCode,
    ).toBe(421);
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/status", headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/generations",
          headers: authorized,
          payload: { blob: "x".repeat(300 * 1024) },
        })
      ).statusCode,
    ).toBe(413);
    await app.close();
  });

  it("returns normalized auth status and completes a generation job", async () => {
    const { app, authorized, provider } = await setup();
    const auth = await app.inject({
      method: "GET",
      url: "/v1/auth/status",
      headers: authorized,
    });
    expect(auth.json()).toMatchObject({
      authenticated: true,
      accountType: "chatgpt",
    });
    const payload = generationPayload();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/generations",
          headers: authorized,
          payload,
        })
      ).statusCode,
    ).toBe(400);
    const mismatched = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: {
        ...authorized,
        "idempotency-key": "threadflow-test-key-mismatch",
        "x-request-fingerprint": "0".repeat(64),
      },
      payload,
    });
    expect(mismatched.statusCode).toBe(409);
    const created = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(authorized, payload),
      payload,
    });
    expect(created.statusCode).toBe(202);
    const id = created.json<{ id: string }>().id;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const replay = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(authorized, payload),
      payload,
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json<{ id: string }>().id).toBe(id);
    expect(provider.generationSessions).toBe(1);
    const conflictPayload = { ...payload, purpose: "다른 목적" };
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(authorized, conflictPayload),
      payload: conflictPayload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    const regenerated = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(
        authorized,
        payload,
        "threadflow-test-key-regenerate",
      ),
      payload,
    });
    expect(regenerated.statusCode).toBe(202);
    expect(regenerated.json<{ id: string }>().id).not.toBe(id);
    expect(provider.generationSessions).toBe(2);
    const result = await app.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: authorized,
    });
    expect(result.json()).toMatchObject({
      state: "COMPLETED",
      providerThreadId: "thread-1",
    });
    const replayedEvents = await app.inject({
      method: "GET",
      url: `/v1/generations/${id}/events`,
      headers: authorized,
    });
    expect(replayedEvents.statusCode).toBe(200);
    expect(replayedEvents.headers["access-control-allow-origin"]).toBe(origin);
    expect(replayedEvents.body).toContain('"state":"COMPLETED"');
    const previewInput = {
      scope: "full",
      feedback: "더 선명하게",
      baseText: "사람이 직접 편집한 최신 본문",
      preview: true,
    };
    const preview = await app.inject({
      method: "POST",
      url: `/v1/generations/${id}/revisions`,
      headers: authorized,
      payload: previewInput,
    });
    expect(preview.statusCode).toBe(200);
    expect(provider.revisionPrompts.at(-1)).toContain(previewInput.baseText);
    const unchanged = await app.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: authorized,
    });
    expect(unchanged.json().result).toEqual(result.json().result);
    for (const invalid of [
      { ...previewInput, baseText: "" },
      { ...previewInput, baseText: undefined },
      { ...previewInput, feedback: 3 },
      { ...previewInput, preview: "yes" },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/generations/${id}/revisions`,
            headers: authorized,
            payload: invalid,
          })
        ).statusCode,
      ).toBe(400);
    }
    let release!: (value: unknown) => void;
    provider.revisionResult = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = app
      .inject({
        method: "POST",
        url: `/v1/generations/${id}/revisions`,
        headers: authorized,
        payload: previewInput,
      })
      .then((value) => value);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/generations/${id}/revisions`,
          headers: authorized,
          payload: previewInput,
        })
      ).statusCode,
    ).toBe(409);
    release({ text: "동시성 검사 수정안" });
    await pending;
    provider.revisionResult = async () => ({ text: "" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/generations/${id}/revisions`,
          headers: authorized,
          payload: previewInput,
        })
      ).statusCode,
    ).toBe(502);
    const revisionSecret = `Bearer ${"r".repeat(24)}`;
    provider.revisionResult = async () => ({ text: revisionSecret });
    const blockedRevision = await app.inject({
      method: "POST",
      url: `/v1/generations/${id}/revisions`,
      headers: authorized,
      payload: previewInput,
    });
    expect(blockedRevision.statusCode).toBe(502);
    expect(blockedRevision.json()).toMatchObject({
      error: { code: "SENSITIVE_PROVIDER_OUTPUT" },
    });
    expect(blockedRevision.body).not.toContain(revisionSecret);
    provider.revisionResult = async () => ({ text: "수정된 최종 글입니다." });
    const revised = await app.inject({
      method: "POST",
      url: `/v1/generations/${id}/revisions`,
      headers: authorized,
      payload: { scope: "hook", feedback: "더 선명하게" },
    });
    expect(revised.json()).toMatchObject({
      finalDraft: { text: "수정된 최종 글입니다." },
    });
    await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: authorized,
    });
    const rejected = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(authorized, payload),
      payload,
    });
    expect(rejected.statusCode).toBe(401);
    await app.close();
  });

  it("cancels an active generation without completing it", async () => {
    const { app, authorized } = await setup(true);
    const payload = generationPayload("s-cancel", "취소");
    const created = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(authorized, payload),
      payload,
    });
    const id = created.json<{ id: string }>().id;
    const coalesced = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(
        authorized,
        payload,
        "threadflow-test-key-other-tab",
      ),
      payload,
    });
    expect(coalesced.json<{ id: string }>().id).toBe(id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/generations/${id}/cancel`,
          headers: authorized,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/generations/${id}`,
          headers: authorized,
        })
      ).json().state,
    ).toBe("CANCELED");
    await app.close();
  });

  it("blocks sensitive provider output before raw deltas or results reach SSE", async () => {
    const { app, authorized, provider } = await setup();
    provider.sensitiveOutput = true;
    const payload = generationPayload("s-sensitive", "보안 검사");
    const created = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: generationHeaders(
        authorized,
        payload,
        "threadflow-sensitive-output-key",
      ),
      payload,
    });
    const id = created.json<{ id: string }>().id;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const snapshot = await app.inject({
      method: "GET",
      url: `/v1/generations/${id}`,
      headers: authorized,
    });
    expect(snapshot.json()).toMatchObject({
      state: "FAILED",
      error: { code: "SENSITIVE_PROVIDER_OUTPUT" },
    });
    const events = await app.inject({
      method: "GET",
      url: `/v1/generations/${id}/events`,
      headers: authorized,
    });
    expect(events.body).not.toContain("Bearer");
    expect(events.body).not.toContain('"type":"delta"');
    expect(events.headers["access-control-allow-origin"]).toBe(origin);
    await app.close();
  });

  it("normalizes a missing Codex App Server as provider unavailable", async () => {
    const provider = new FakeProvider();
    provider.getAuthStatus = async () => {
      throw new Error("spawn codex ENOENT");
    };
    const app = await buildGateway({
      port,
      allowedOrigins: [origin],
      bootstrapSecret: "bootstrap",
      provider,
    });
    const boot = await app.inject({
      method: "POST",
      url: "/v1/session/bootstrap",
      headers: { ...headers, "x-threadflow-bootstrap": "bootstrap" },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/status",
      headers: {
        ...headers,
        authorization: `Bearer ${boot.json<{ token: string }>().token}`,
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE", retryable: true },
    });
    await app.close();
  });
});
