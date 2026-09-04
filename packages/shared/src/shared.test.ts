import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AesGcmVault,
  SessionTokens,
  diffWords,
  redactText,
  safeLog,
} from "./index.js";

describe("shared security helpers", () => {
  afterEach(() => vi.useRealTimers());
  it("redacts credential-shaped values and discards content fields", () => {
    expect(redactText("Bearer abc.def.ghi")).toContain("[REDACTED]");
    expect(
      safeLog({ requestId: "r1", sourceText: "secret", accessToken: "token" }),
    ).toEqual({ requestId: "r1" });
  });

  it("issues expiring subject-bound session tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
    const sessions = new SessionTokens("bootstrap", 1_000);
    const issued = sessions.issue("chrome-extension://abc");
    expect(sessions.verify(issued.token, "chrome-extension://abc")).toBe(true);
    expect(sessions.verify(issued.token, "chrome-extension://evil")).toBe(
      false,
    );
    expect(
      sessions.verify(`${issued.token}.suffix`, "chrome-extension://abc"),
    ).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(sessions.verify(issued.token, "chrome-extension://abc")).toBe(false);
  });

  it("encrypts tokens with tenant-bound associated data", () => {
    const vault = new AesGcmVault(randomBytes(32).toString("base64"));
    const encrypted = vault.encrypt("access-token", "tenant-a:account-a");
    expect(encrypted).not.toContain("access-token");
    expect(vault.decrypt(encrypted, "tenant-a:account-a")).toBe("access-token");
    expect(() => vault.decrypt(encrypted, "tenant-b:account-a")).toThrow();
  });

  it("returns stable word diffs", () => {
    expect(
      diffWords("오늘 글", "오늘 좋은 글").map((chunk) => chunk.type),
    ).toContain("insert");
  });
});
