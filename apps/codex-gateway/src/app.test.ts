import { describe, expect, it } from "vitest";
import type { AuthStatus } from "@threadflow-os/contracts";
import type { GenerationProviderSession } from "./generation-manager.js";
import { buildGateway, type GatewayProvider } from "./app.js";

const origin = "chrome-extension://threadflow-test";
const port = 8787;
const headers = { host: `127.0.0.1:${port}`, origin };

class FakeProvider implements GatewayProvider {
  closed = false;
  authenticated = true;
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
      generateJson: async ({ stage }) => {
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
    const created = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: authorized,
      payload: {
        source: {
          id: "s",
          text: "참고 글",
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
        purpose: "테스트",
        mode: "new",
        variationStrength: 0.8,
        candidateCount: 3,
        userEvidence: [],
        affiliateDisclosure: null,
      },
    });
    expect(created.statusCode).toBe(202);
    const id = created.json<{ id: string }>().id;
    await new Promise((resolve) => setTimeout(resolve, 20));
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
      headers: authorized,
      payload: {
        source: {
          id: "s",
          text: "참고 글",
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
        purpose: "테스트",
        mode: "new",
        variationStrength: 0.8,
        candidateCount: 3,
        userEvidence: [],
        affiliateDisclosure: null,
      },
    });
    expect(rejected.statusCode).toBe(401);
    await app.close();
  });

  it("cancels an active generation without completing it", async () => {
    const { app, authorized } = await setup(true);
    const created = await app.inject({
      method: "POST",
      url: "/v1/generations",
      headers: authorized,
      payload: {
        source: {
          id: "s-cancel",
          text: "취소 테스트 참고 글",
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
        purpose: "취소",
        mode: "new",
        variationStrength: 0.8,
        candidateCount: 3,
        userEvidence: [],
        affiliateDisclosure: null,
      },
    });
    const id = created.json<{ id: string }>().id;
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
