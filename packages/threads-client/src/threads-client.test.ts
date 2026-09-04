import { describe, expect, it, vi } from "vitest";
import { ThreadsApiClient, createPkce } from "./index.js";
import type { ThreadsApiError } from "./index.js";

const config = {
  appId: "app",
  appSecret: "secret",
  redirectUri: "http://localhost/callback",
  graphBaseUrl: "https://graph.threads.net/v1.0",
  usePkce: true,
};

describe("official Threads API client", () => {
  it("creates a state-bound PKCE authorization URL", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier.length).toBeGreaterThan(40);
    const url = new URL(
      new ThreadsApiClient(config).createAuthorization("state", challenge),
    );
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("threads_content_publish");
  });

  it("does not send non-documented PKCE parameters unless explicitly enabled", () => {
    const client = new ThreadsApiClient({ ...config, usePkce: false });
    const url = new URL(client.createAuthorization("state", "challenge"));
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });

  it("rejects text beyond the documented 500-unit limit before network I/O", async () => {
    const fetchMock = vi.fn();
    const client = new ThreadsApiClient(config, fetchMock);
    await expect(
      client.createContainer({
        userId: "u",
        accessToken: "token",
        text: "가".repeat(501),
      }),
    ).rejects.toMatchObject({ code: "THREADS_LIMIT_EXCEEDED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty posts and malformed success responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const client = new ThreadsApiClient(config, fetchMock);
    await expect(
      client.createContainer({
        userId: "u",
        accessToken: "token",
        text: "   ",
      }),
    ).rejects.toMatchObject({ code: "EMPTY_TEXT" });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(client.getProfile("token")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("creates a text container and publishes it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "container" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "post" }), { status: 200 }),
      );
    const client = new ThreadsApiClient(config, fetchMock);
    const container = await client.createContainer({
      userId: "user",
      accessToken: "token",
      text: "hello",
    });
    const post = await client.publish({
      userId: "user",
      accessToken: "token",
      containerId: container.id,
    });
    expect(post.id).toBe("post");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks uncertain publish outcomes as non-retryable", async () => {
    const client = new ThreadsApiClient(
      config,
      vi.fn().mockRejectedValue(new TypeError("connection reset")),
    );
    await expect(
      client.publish({
        userId: "user",
        accessToken: "token",
        containerId: "container",
      }),
    ).rejects.toMatchObject({
      code: "PUBLISH_OUTCOME_UNKNOWN",
      retryable: false,
      outcomeUnknown: true,
    } satisfies Partial<ThreadsApiError>);
  });

  it("classifies rate limits as retryable", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 4, message: "rate limited" } }),
      { status: 429 },
    );
    const client = new ThreadsApiClient(
      config,
      vi.fn().mockResolvedValue(response),
    );
    await expect(client.getProfile("token")).rejects.toMatchObject({
      status: 429,
      retryable: true,
    });
  });
});
