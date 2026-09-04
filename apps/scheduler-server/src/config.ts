import {
  WorkspaceContextSchema,
  type WorkspaceContext,
} from "@threadflow-os/contracts";

const unsupportedLocalHosts = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

/**
 * Threads OAuth does not accept localhost callback URLs and requires HTTPS.
 * A custom hostname that resolves to loopback is allowed when TLS is terminated
 * by a trusted local certificate or reverse proxy.
 */
export function validateMetaRedirectUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("META_REDIRECT_URI must be a valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("META_REDIRECT_URI must use HTTPS for Threads OAuth");
  }
  if (unsupportedLocalHosts.has(url.hostname.toLowerCase())) {
    throw new Error(
      "META_REDIRECT_URI cannot use localhost or a loopback IP; use an HTTPS tunnel or a custom hostname",
    );
  }
  if (url.username || url.password || url.hash) {
    throw new Error(
      "META_REDIRECT_URI cannot contain credentials or a URL fragment",
    );
  }
  if (url.pathname !== "/v1/threads/oauth/callback" || url.search.length > 0) {
    throw new Error(
      "META_REDIRECT_URI must use the exact /v1/threads/oauth/callback path without query parameters",
    );
  }
  return value;
}

export function parseSchedulerAccessKeys(
  value: string,
): Map<string, WorkspaceContext> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("SCHEDULER_ACCESS_KEYS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("SCHEDULER_ACCESS_KEYS_JSON must be a JSON object");
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.length)
    throw new Error("SCHEDULER_ACCESS_KEYS_JSON must contain an access key");
  return new Map(
    entries.map(([key, context]) => {
      if (key.length < 32 || /^replace-|example|change-me/i.test(key))
        throw new Error(
          "Scheduler access keys must be replaced with at least 32 random characters",
        );
      return [key, WorkspaceContextSchema.parse(context)] as const;
    }),
  );
}
