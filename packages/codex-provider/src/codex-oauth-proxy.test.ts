import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexOAuthProxyAdapter,
  loadCodexOAuthProxyConfig,
} from "./codex-oauth-proxy.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function credential() {
  const root = await mkdtemp(join(tmpdir(), "threadflow-proxy-test-"));
  roots.push(root);
  const file = join(root, "caller.secret");
  const secret = "p".repeat(32);
  await writeFile(file, `${secret}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return { file, secret };
}

describe("Codex OAuth Proxy configuration", () => {
  it("requires a loopback URL and an absolute credential file", async () => {
    const { file } = await credential();
    expect(loadCodexOAuthProxyConfig({}).enabled).toBe(false);
    expect(
      loadCodexOAuthProxyConfig({
        THREADFLOW_CODEX_PROXY_BASE_URL: "http://127.0.0.1:4348",
        THREADFLOW_CODEX_PROXY_SECRET_FILE: file,
      }),
    ).toMatchObject({ enabled: true, callerId: "threadflow" });
    expect(() =>
      loadCodexOAuthProxyConfig({
        THREADFLOW_CODEX_PROXY_BASE_URL: "https://proxy.example.com",
        THREADFLOW_CODEX_PROXY_SECRET_FILE: file,
      }),
    ).toThrow("loopback");
    expect(() =>
      loadCodexOAuthProxyConfig({
        THREADFLOW_CODEX_PROXY_BASE_URL: "http://127.0.0.1:4348",
        THREADFLOW_CODEX_PROXY_SECRET_FILE: "relative.secret",
      }),
    ).toThrow("absolute path");
  });

  it("reports missing and unsafe credentials without exposing their path", async () => {
    const { file } = await credential();
    await chmod(file, 0o644);
    let calls = 0;
    const adapter = new CodexOAuthProxyAdapter(
      loadCodexOAuthProxyConfig({
        THREADFLOW_CODEX_PROXY_BASE_URL: "http://127.0.0.1:4348",
        THREADFLOW_CODEX_PROXY_SECRET_FILE: file,
      }),
      {
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ ready: true }));
        },
      },
    );
    const status = await adapter.getAuthStatus();
    expect(status).toMatchObject({
      authenticated: false,
      providerMode: "proxy",
      readinessReason: "proxy_credential_unavailable",
    });
    expect(calls).toBe(0);
    expect(JSON.stringify(status)).not.toContain(file);
  });
});

describe("Codex OAuth Proxy calls", () => {
  it("uses the explicit capability and returns validated JSON", async () => {
    const { file, secret } = await credential();
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const adapter = new CodexOAuthProxyAdapter(
      loadCodexOAuthProxyConfig({
        THREADFLOW_CODEX_PROXY_BASE_URL: "http://127.0.0.1:4348",
        THREADFLOW_CODEX_PROXY_SECRET_FILE: file,
      }),
      {
        fetchImpl: async (input, init) => {
          const url = String(input);
          seen.push({ url, init });
          if (url.endsWith("/ready"))
            return new Response(
              JSON.stringify({ ready: true, version: "proxy-test" }),
            );
          return new Response(
            JSON.stringify({ text: JSON.stringify({ text: "정상 결과" }) }),
          );
        },
      },
    );
    expect(await adapter.getAuthStatus()).toMatchObject({
      authenticated: true,
      providerVersion: "proxy-test",
      providerMode: "proxy",
    });
    const session = adapter.createGenerationProvider();
    await expect(
      session.generateJson({
        stage: "ANALYZING",
        prompt: "prompt",
        schema: {},
      }),
    ).resolves.toEqual({ text: "정상 결과" });
    const request = seen.at(-1)!;
    const headers = request.init?.headers as Record<string, string>;
    const body = JSON.parse(String(request.init?.body)) as {
      capability: string;
      input: {
        messages: Array<{ role: string; content: string }>;
        model: string;
        reasoningEffort: string;
      };
    };
    expect(headers.authorization).toBe(`Bearer ${secret}`);
    expect(headers["x-heybot-service-id"]).toBe("threadflow");
    expect(body.capability).toBe("conversation.respond.v1");
    expect(body.input.messages[0]?.role).toBe("system");
    expect(body.input.messages[1]?.content).toContain("OUTPUT_SCHEMA=");
    expect(body.input.model).toBe("gpt-5.6-sol");
    expect(body.input.reasoningEffort).toBe("xhigh");
    expect(
      JSON.stringify(await session.revise!(session.threadId()!, "p", {})),
    ).not.toContain(secret);
  });

  it("chunks long prompts within the Proxy message contract", async () => {
    const { file } = await credential();
    let requestBody: {
      input: { messages: Array<{ role: string; content: string }> };
    } | null = null;
    const adapter = new CodexOAuthProxyAdapter(
      loadCodexOAuthProxyConfig({
        THREADFLOW_CODEX_PROXY_BASE_URL: "http://127.0.0.1:4348",
        THREADFLOW_CODEX_PROXY_SECRET_FILE: file,
      }),
      {
        fetchImpl: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({ text: JSON.stringify({ text: "정상 결과" }) }),
          );
        },
      },
    );
    const prompt = `${"긴 입력🙂".repeat(1_200)}\nEND_MARKER`;
    await adapter.createGenerationProvider().generateJson({
      stage: "ANALYZING",
      prompt,
      schema: { type: "object" },
    });
    const messages = requestBody!.input.messages;
    expect(messages.length).toBeGreaterThan(2);
    expect(messages.length).toBeLessThanOrEqual(32);
    expect(messages.every((message) => message.content.length <= 4_000)).toBe(
      true,
    );
    expect(messages.at(-1)?.content).toContain("OUTPUT_SCHEMA=");
    expect(messages.at(-1)?.content).toContain("END_MARKER");
  });

  it("sanitizes upstream errors and blocks sensitive output", async () => {
    const { file, secret } = await credential();
    let status = 401;
    const adapter = new CodexOAuthProxyAdapter(
      loadCodexOAuthProxyConfig({
        THREADFLOW_CODEX_PROXY_BASE_URL: "http://127.0.0.1:4348",
        THREADFLOW_CODEX_PROXY_SECRET_FILE: file,
      }),
      {
        fetchImpl: async (input) => {
          if (String(input).endsWith("/ready"))
            return new Response(JSON.stringify({ ready: true }));
          if (status)
            return new Response(
              JSON.stringify({ error: `${secret} /Users/private/file` }),
              { status },
            );
          return new Response(
            JSON.stringify({
              text: JSON.stringify({ text: `Bearer ${"x".repeat(24)}` }),
            }),
          );
        },
      },
    );
    const first = adapter.createGenerationProvider();
    await expect(
      first.generateJson({ stage: "ANALYZING", prompt: "p", schema: {} }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(
      first.generateJson({ stage: "ANALYZING", prompt: "p", schema: {} }),
    ).rejects.not.toThrow(secret);
    status = 429;
    await expect(
      first.generateJson({ stage: "ANALYZING", prompt: "p", schema: {} }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    status = 503;
    await expect(
      first.generateJson({ stage: "ANALYZING", prompt: "p", schema: {} }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    status = 0;
    await expect(
      first.generateJson({ stage: "ANALYZING", prompt: "p", schema: {} }),
    ).rejects.toMatchObject({ code: "SENSITIVE_PROVIDER_OUTPUT" });
  });

  it("distinguishes caller cancellation from a bounded timeout", async () => {
    const { file } = await credential();
    const loaded = loadCodexOAuthProxyConfig({
      THREADFLOW_CODEX_PROXY_BASE_URL: "http://127.0.0.1:4348",
      THREADFLOW_CODEX_PROXY_SECRET_FILE: file,
    });
    if (!loaded.enabled) throw new Error("expected enabled proxy config");
    const adapter = new CodexOAuthProxyAdapter(
      { ...loaded, timeoutMs: 5 },
      {
        fetchImpl: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      },
    );
    const canceledSession = adapter.createGenerationProvider();
    const controller = new AbortController();
    const canceled = canceledSession.generateJson({
      stage: "ANALYZING",
      prompt: "p",
      schema: {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ code: "CANCELED" });

    const timedSession = adapter.createGenerationProvider();
    await expect(
      timedSession.generateJson({
        stage: "ANALYZING",
        prompt: "p",
        schema: {},
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
