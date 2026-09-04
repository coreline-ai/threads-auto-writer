import type { FastifyReply, FastifyRequest } from "fastify";
import { constantTimeEqual } from "@threadflow-os/shared";
import type { SessionTokens } from "@threadflow-os/shared";

export type GatewaySecurity = {
  allowedOrigins: Set<string>;
  bootstrapSecret: string;
  sessions: SessionTokens;
  port: number;
};

export function requestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  return typeof origin === "string" ? origin : null;
}

export function validateHost(
  hostHeader: string | undefined,
  port: number,
): boolean {
  if (!hostHeader) return false;
  const normalized = hostHeader.toLowerCase();
  return [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    "[::1]:" + port,
    "127.0.0.1",
    "localhost",
    "[::1]",
  ].includes(normalized);
}

export function validateOrigin(
  origin: string | null,
  allowedOrigins: Set<string>,
): boolean {
  return origin !== null && allowedOrigins.has(origin);
}

export function verifyBootstrap(
  request: FastifyRequest,
  security: GatewaySecurity,
): boolean {
  const supplied = request.headers["x-threadflow-bootstrap"];
  return (
    typeof supplied === "string" &&
    constantTimeEqual(supplied, security.bootstrapSecret)
  );
}

export function verifySession(
  request: FastifyRequest,
  security: GatewaySecurity,
): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const origin = requestOrigin(request);
  return origin !== null && security.sessions.verify(header.slice(7), origin);
}

export function reject(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) {
  return reply
    .code(statusCode)
    .send({ error: { code, message, retryable: false } });
}
