import { describe, expect, it } from "vitest";
import { parseSchedulerAccessKeys, validateMetaRedirectUri } from "./config.js";

describe("scheduler configuration", () => {
  it("accepts a non-local HTTPS callback and rejects unsupported callbacks", () => {
    expect(
      validateMetaRedirectUri(
        "https://threads-oauth.example.test/v1/threads/oauth/callback",
      ),
    ).toBe("https://threads-oauth.example.test/v1/threads/oauth/callback");
    expect(() =>
      validateMetaRedirectUri(
        "http://threads-oauth.example.test/v1/threads/oauth/callback",
      ),
    ).toThrow(/HTTPS/);
    expect(() =>
      validateMetaRedirectUri(
        "https://localhost:8788/v1/threads/oauth/callback",
      ),
    ).toThrow(/localhost/);
    expect(() =>
      validateMetaRedirectUri(
        "https://127.0.0.1:8788/v1/threads/oauth/callback",
      ),
    ).toThrow(/loopback/);
    expect(() =>
      validateMetaRedirectUri(
        "https://threads-oauth.example.test/wrong-callback",
      ),
    ).toThrow(/exact/);
    expect(() =>
      validateMetaRedirectUri(
        "https://threads-oauth.example.test/v1/threads/oauth/callback?tenant=a",
      ),
    ).toThrow(/query/);
  });

  it("requires a long random scheduler key with a valid workspace context", () => {
    const key = "a".repeat(32);
    expect(
      parseSchedulerAccessKeys(
        JSON.stringify({
          [key]: {
            tenantId: "tenant",
            workspaceId: "workspace",
            userId: "user",
            role: "owner",
          },
        }),
      ).get(key),
    ).toMatchObject({ role: "owner" });
    expect(() =>
      parseSchedulerAccessKeys(
        JSON.stringify({
          "replace-with-long-random-key": {
            tenantId: "tenant",
            workspaceId: "workspace",
            userId: "user",
            role: "owner",
          },
        }),
      ),
    ).toThrow(/random/);
    expect(() => parseSchedulerAccessKeys("{}")).toThrow(/contain/);
  });
});
