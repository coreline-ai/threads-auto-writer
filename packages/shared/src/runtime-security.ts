export type ProviderOutputDlpIssueCode =
  | "SENSITIVE_KEY"
  | "AUTHORIZATION_VALUE"
  | "TOKEN_VALUE"
  | "JWT_VALUE"
  | "CREDENTIAL_QUERY"
  | "PRIVATE_LOCAL_PATH";

export type ProviderOutputDlpIssue = {
  code: ProviderOutputDlpIssueCode;
  path: string;
};

const SENSITIVE_KEY =
  /^(?:access|refresh|id)?token$|^(?:api|client)?secret$|^password$|^authorization$|^privatekey$|^apikey$/u;
const VALUE_PATTERNS: Array<{
  code: Exclude<ProviderOutputDlpIssueCode, "SENSITIVE_KEY">;
  pattern: RegExp;
}> = [
  {
    code: "AUTHORIZATION_VALUE",
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/._~=-]{12,}/iu,
  },
  {
    code: "TOKEN_VALUE",
    pattern: /\b(?:sk|sess)-[A-Za-z0-9_-]{16,}\b/u,
  },
  {
    code: "JWT_VALUE",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  },
  {
    code: "CREDENTIAL_QUERY",
    pattern: /[?&](?:access_token|refresh_token|code|api_key)=[^&\s]+/iu,
  },
  {
    code: "PRIVATE_LOCAL_PATH",
    pattern:
      /(?:^|[\s"'(])(?:\/(?:Users|Volumes|home)\/[^\s"')]+|[A-Z]:\\Users\\[^\s"')]+)/u,
  },
];

function normalizedKey(key: string): string {
  return key.replace(/[-_\s]/g, "").toLocaleLowerCase("en-US");
}

export function providerOutputDlpIssues(
  value: unknown,
): ProviderOutputDlpIssue[] {
  const issues: ProviderOutputDlpIssue[] = [];
  const seen = new Set<object>();

  const walk = (item: unknown, path: string): void => {
    if (typeof item === "string") {
      for (const entry of VALUE_PATTERNS) {
        if (entry.pattern.test(item)) issues.push({ code: entry.code, path });
      }
      return;
    }
    if (!item || typeof item !== "object") return;
    if (seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      item.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(
      item as Record<string, unknown>,
    )) {
      const childPath = path ? `${path}.${key}` : key;
      if (
        SENSITIVE_KEY.test(normalizedKey(key)) &&
        child !== null &&
        child !== undefined &&
        child !== ""
      )
        issues.push({ code: "SENSITIVE_KEY", path: childPath });
      walk(child, childPath);
    }
  };

  walk(value, "$output");
  return issues;
}

export function assertProviderOutputSafe(value: unknown): void {
  if (providerOutputDlpIssues(value).length)
    throw new Error(
      "SENSITIVE_PROVIDER_OUTPUT: Provider output was blocked by the data-loss-prevention policy",
    );
}
