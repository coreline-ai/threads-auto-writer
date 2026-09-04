import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";

export { diffWords, type DiffChunk } from "./diff.js";

export const nowIso = (): string => new Date().toISOString();
export const createId = (prefix = "tf"): string =>
  `${prefix}_${crypto.randomUUID()}`;
export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const TOKEN_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:sk|sess|eyJ)[A-Za-z0-9._-]{16,}\b/g,
  /("?(?:access|refresh|id)[_-]?token"?\s*[:=]\s*")[^"]+("?)/gi,
  /([?&](?:access_token|code)=)[^&\s]+/gi,
];

export function redactText(input: string): string {
  return TOKEN_PATTERNS.reduce(
    (value, pattern) => value.replace(pattern, "$1[REDACTED]$2"),
    input,
  );
}

export function safeLog(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set([
    "requestId",
    "generationId",
    "state",
    "stage",
    "durationMs",
    "providerVersion",
    "promptVersion",
    "rubricVersion",
    "statusCode",
    "errorCode",
    "retryable",
    "tenantId",
    "workspaceId",
    "jobId",
  ]);
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [
        key,
        typeof value === "string" ? redactText(value) : value,
      ]),
  );
}

export async function loadOrCreateSecret(
  path: string,
  size = 32,
): Promise<string> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const secret = randomBytes(size).toString("base64url");
    await writeFile(path, `${secret}\n`, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
    return secret;
  }
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SessionTokens {
  readonly #secret: Buffer;
  readonly #ttlMs: number;

  constructor(secret: string, ttlMs = 15 * 60_000) {
    this.#secret = createHash("sha256").update(secret).digest();
    this.#ttlMs = ttlMs;
  }

  issue(subject: string): { token: string; expiresAt: string } {
    const expiresAtMs = Date.now() + this.#ttlMs;
    const nonce = randomBytes(16).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: subject, exp: expiresAtMs, nonce }),
    ).toString("base64url");
    const signature = createHmac("sha256", this.#secret)
      .update(payload)
      .digest("base64url");
    return {
      token: `${payload}.${signature}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  verify(token: string, subject?: string): boolean {
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    if (!payload || !signature) return false;
    const expected = createHmac("sha256", this.#secret)
      .update(payload)
      .digest("base64url");
    if (!constantTimeEqual(signature, expected)) return false;
    try {
      const data = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as {
        sub: string;
        exp: number;
      };
      return data.exp > Date.now() && (!subject || data.sub === subject);
    } catch {
      return false;
    }
  }
}

export class AesGcmVault {
  readonly #key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32)
      throw new Error(
        "SCHEDULER_MASTER_KEY must be a base64 encoded 32-byte key",
      );
    this.#key = key;
  }

  encrypt(plainText: string, associatedData: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(associatedData));
    const encrypted = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64url");
  }

  decrypt(payload: string, associatedData: string): string {
    const bytes = Buffer.from(payload, "base64url");
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const encrypted = bytes.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  }
}
