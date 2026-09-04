import { createHash, randomBytes } from "node:crypto";
import { countThreadsTextUnits } from "@threadflow-os/contracts";

export type ThreadsClientConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphBaseUrl?: string;
  authorizationUrl?: string;
  /** Enable only when the configured Meta app explicitly supports PKCE. */
  usePkce?: boolean;
};

export type TokenResponse = {
  access_token: string;
  user_id?: string | number;
  expires_in?: number;
  token_type?: string;
};

export class ThreadsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly outcomeUnknown = false,
  ) {
    super(message);
  }
}

export class ThreadsApiClient {
  readonly #graphBaseUrl: string;
  readonly #graphOrigin: string;
  readonly #authorizationUrl: string;

  constructor(
    private readonly config: ThreadsClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#graphBaseUrl = (
      config.graphBaseUrl ?? "https://graph.threads.net/v1.0"
    ).replace(/\/$/, "");
    this.#graphOrigin = new URL(this.#graphBaseUrl).origin;
    this.#authorizationUrl =
      config.authorizationUrl ?? "https://threads.net/oauth/authorize";
  }

  get redirectUri(): string {
    return this.config.redirectUri;
  }

  get usesPkce(): boolean {
    return this.config.usePkce === true;
  }

  createAuthorization(
    state: string,
    codeChallenge: string,
    scopes = [
      "threads_basic",
      "threads_content_publish",
      "threads_manage_insights",
    ],
  ): string {
    const url = new URL(this.#authorizationUrl);
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    if (this.config.usePkce) {
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  async exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
    return validateTokenResponse(
      await this.postForm<unknown>(`${this.#graphOrigin}/oauth/access_token`, {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        code,
        ...(this.config.usePkce ? { code_verifier: verifier } : {}),
      }),
    );
  }

  async exchangeLongLivedToken(
    shortLivedToken: string,
  ): Promise<TokenResponse> {
    const url = new URL(`${this.#graphOrigin}/access_token`);
    url.searchParams.set("grant_type", "th_exchange_token");
    url.searchParams.set("client_secret", this.config.appSecret);
    url.searchParams.set("access_token", shortLivedToken);
    return validateTokenResponse(await this.get<unknown>(url));
  }

  async refreshToken(longLivedToken: string): Promise<TokenResponse> {
    const url = new URL(`${this.#graphOrigin}/refresh_access_token`);
    url.searchParams.set("grant_type", "th_refresh_token");
    url.searchParams.set("access_token", longLivedToken);
    return validateTokenResponse(await this.get<unknown>(url));
  }

  async getProfile(
    accessToken: string,
  ): Promise<{ id: string; username?: string }> {
    const url = this.authenticatedUrl("/me", accessToken);
    url.searchParams.set("fields", "id,username");
    const profile = await this.get<unknown>(url);
    if (!profile || typeof profile !== "object") throw invalidResponse();
    const { id, username } = profile as { id?: unknown; username?: unknown };
    if ((typeof id !== "string" && typeof id !== "number") || !String(id))
      throw invalidResponse();
    if (username !== undefined && typeof username !== "string")
      throw invalidResponse();
    return {
      id: String(id),
      ...(typeof username === "string" ? { username } : {}),
    };
  }

  async createContainer(input: {
    userId: string;
    accessToken: string;
    text: string;
    imageUrl?: string | null;
    altText?: string | null;
  }): Promise<{ id: string }> {
    if (!input.text.trim())
      throw new ThreadsApiError(
        "Threads text cannot be empty",
        400,
        "EMPTY_TEXT",
        false,
      );
    if (countThreadsTextUnits(input.text) > 500)
      throw new ThreadsApiError(
        "Threads text limit exceeded",
        400,
        "THREADS_LIMIT_EXCEEDED",
        false,
      );
    const body: Record<string, string> = {
      media_type: input.imageUrl ? "IMAGE" : "TEXT",
      text: input.text,
      access_token: input.accessToken,
    };
    if (input.imageUrl) body.image_url = input.imageUrl;
    if (input.altText) body.alt_text = input.altText;
    return validateIdResponse(
      await this.postForm(
        `${this.#graphBaseUrl}/${encodeURIComponent(input.userId)}/threads`,
        body,
      ),
    );
  }

  async getContainerStatus(
    containerId: string,
    accessToken: string,
  ): Promise<{ id: string; status?: string; error_message?: string }> {
    const url = this.authenticatedUrl(
      `/${encodeURIComponent(containerId)}`,
      accessToken,
    );
    url.searchParams.set("fields", "id,status,error_message");
    return this.get(url);
  }

  async publish(input: {
    userId: string;
    accessToken: string;
    containerId: string;
  }): Promise<{ id: string }> {
    try {
      return validateIdResponse(
        await this.postForm(
          `${this.#graphBaseUrl}/${encodeURIComponent(input.userId)}/threads_publish`,
          {
            creation_id: input.containerId,
            access_token: input.accessToken,
          },
        ),
      );
    } catch (error) {
      if (
        error instanceof ThreadsApiError &&
        (error.code === "NETWORK" || error.status >= 500)
      ) {
        throw new ThreadsApiError(
          "Publish response was not confirmed; automatic retry is disabled to prevent duplicate posts.",
          error.status,
          "PUBLISH_OUTCOME_UNKNOWN",
          false,
          true,
        );
      }
      throw error;
    }
  }

  async getInsights(
    postId: string,
    accessToken: string,
    metrics: string[],
  ): Promise<unknown> {
    const url = this.authenticatedUrl(
      `/${encodeURIComponent(postId)}/insights`,
      accessToken,
    );
    url.searchParams.set("metric", metrics.join(","));
    return this.get(url);
  }

  private authenticatedUrl(path: string, accessToken: string): URL {
    const url = new URL(`${this.#graphBaseUrl}${path}`);
    url.searchParams.set("access_token", accessToken);
    return url;
  }

  private async get<T>(url: URL): Promise<T> {
    return this.request<T>(url, { method: "GET" });
  }

  private async postForm<T>(
    url: string,
    body: Record<string, string>,
  ): Promise<T> {
    return this.request<T>(new URL(url), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      throw new ThreadsApiError(
        "Threads API network failure",
        0,
        "NETWORK",
        true,
      );
    }
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      const code = String(payload?.error?.code ?? `HTTP_${response.status}`);
      const message = String(
        payload?.error?.message ?? "Threads API request failed",
      );
      const retryable = response.status === 429 || response.status >= 500;
      throw new ThreadsApiError(message, response.status, code, retryable);
    }
    return payload as T;
  }
}

function validateTokenResponse(payload: unknown): TokenResponse {
  if (!payload || typeof payload !== "object") throw invalidResponse();
  const response = payload as Record<string, unknown>;
  if (
    typeof response.access_token !== "string" ||
    !response.access_token ||
    (response.expires_in !== undefined &&
      (typeof response.expires_in !== "number" || response.expires_in <= 0))
  )
    throw invalidResponse();
  return response as TokenResponse;
}

function validateIdResponse(payload: unknown): { id: string } {
  if (!payload || typeof payload !== "object") throw invalidResponse();
  const id = (payload as { id?: unknown }).id;
  if ((typeof id !== "string" && typeof id !== "number") || !String(id))
    throw invalidResponse();
  return { id: String(id) };
}

function invalidResponse(): ThreadsApiError {
  return new ThreadsApiError(
    "Threads API returned an invalid response",
    502,
    "INVALID_RESPONSE",
    false,
  );
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}
