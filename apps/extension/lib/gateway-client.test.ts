// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationRequest } from "@threadflow-os/contracts";
import { GatewayClient } from "./gateway-client.js";

const request = {
  source: {
    id: "source-1",
    text: "참고 글",
    author: null,
    url: null,
    capturedAt: "2026-09-04T00:00:00.000Z",
    captureMethod: "paste",
    adapterVersion: "threads-web-v1",
  },
  persona: {
    id: "persona-1",
    name: "실무자",
    audience: "독자",
    voice: "간결하게",
    goals: [],
    bannedPhrases: [],
    preferredLength: { min: 20, max: 500 },
    language: "ko-KR",
  },
  purpose: "중복 제출 방지",
  mode: "new",
  variationStrength: 0.8,
  candidateCount: 3,
  userEvidence: [],
  affiliateDisclosure: null,
} satisfies GenerationRequest;

describe("GatewayClient generation single-flight", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("coalesces simultaneous submissions and permits an explicit retry", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstGeneration = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let generationCalls = 0;
    const generationHeaders: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/session/bootstrap")) {
          return new Response(JSON.stringify({ token: "session-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        generationCalls += 1;
        generationHeaders.push(init?.headers as Record<string, string>);
        if (generationCalls === 1) return firstGeneration;
        return new Response(JSON.stringify({ id: "generation-retry" }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GatewayClient(
      "http://127.0.0.1:8787",
      async () => "bootstrap",
    );
    const first = client.createGeneration(request);
    const duplicate = client.createGeneration(request);
    await vi.waitFor(() => expect(generationCalls).toBe(1));
    resolveFirst(
      new Response(JSON.stringify({ id: "generation-first" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { id: "generation-first" },
      { id: "generation-first" },
    ]);

    await expect(client.createGeneration(request)).resolves.toEqual({
      id: "generation-retry",
    });
    expect(generationCalls).toBe(2);
    expect(generationHeaders[0]?.["x-request-fingerprint"]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(generationHeaders[1]?.["x-request-fingerprint"]).toBe(
      generationHeaders[0]?.["x-request-fingerprint"],
    );
    expect(generationHeaders[1]?.["idempotency-key"]).not.toBe(
      generationHeaders[0]?.["idempotency-key"],
    );
  });

  it("keeps the same idempotency identity across a session refresh retry", async () => {
    let bootstrapCalls = 0;
    const attempts: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/session/bootstrap")) {
          bootstrapCalls += 1;
          return new Response(
            JSON.stringify({ token: `session-${bootstrapCalls}` }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        attempts.push(init?.headers as Record<string, string>);
        if (attempts.length === 1)
          return new Response(
            JSON.stringify({
              error: { code: "INVALID_SESSION", message: "expired" },
            }),
            { status: 401, headers: { "content-type": "application/json" } },
          );
        return new Response(
          JSON.stringify({ id: "generation-after-refresh" }),
          {
            status: 202,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new GatewayClient(
      "http://127.0.0.1:8787",
      async () => "bootstrap",
    );
    await expect(client.createGeneration(request)).resolves.toEqual({
      id: "generation-after-refresh",
    });
    expect(bootstrapCalls).toBe(2);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.["idempotency-key"]).toBe(
      attempts[0]?.["idempotency-key"],
    );
    expect(attempts[1]?.["x-request-fingerprint"]).toBe(
      attempts[0]?.["x-request-fingerprint"],
    );
    expect(attempts[0]?.authorization).toBe("Bearer session-1");
    expect(attempts[1]?.authorization).toBe("Bearer session-2");
  });
});
