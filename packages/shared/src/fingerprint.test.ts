import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  generationRequestFingerprint,
  sha256Hex,
} from "./fingerprint.js";
import { providerOutputDlpIssues } from "./runtime-security.js";

describe("portable fingerprints", () => {
  it("canonicalizes key order and skips undefined object fields", () => {
    expect(canonicalJson({ b: "한글", a: 1, ignored: undefined })).toBe(
      '{"a":1,"b":"한글"}',
    );
    expect(generationRequestFingerprint({ b: ["한글", "🚀"], a: true })).toBe(
      generationRequestFingerprint({ a: true, b: ["한글", "🚀"] }),
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("rejects values that JSON cannot fingerprint safely", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("non-finite");
    expect(() => canonicalJson({ value: BigInt(1) })).toThrow("unsupported");
  });
});

describe("provider output DLP", () => {
  it("passes ordinary writing output", () => {
    expect(
      providerOutputDlpIssues({ text: "오늘은 하나의 행동만 정해보세요." }),
    ).toEqual([]);
  });

  it("detects credentials and private paths without returning their values", () => {
    const secret = "sk-super-private-value-123456789";
    const path = "/Users/private/project/file.txt";
    const issues = providerOutputDlpIssues({
      access_token: secret,
      text: `Bearer abcdefghijklmnopqrst ${path}`,
    });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "SENSITIVE_KEY",
        "TOKEN_VALUE",
        "AUTHORIZATION_VALUE",
        "PRIVATE_LOCAL_PATH",
      ]),
    );
    expect(JSON.stringify(issues)).not.toContain(secret);
    expect(JSON.stringify(issues)).not.toContain(path);
  });
});
