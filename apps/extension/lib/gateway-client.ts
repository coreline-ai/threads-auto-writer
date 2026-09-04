import {
  AuthStatusSchema,
  FinalDraftSchema,
  GenerationEventSchema,
  type GenerationEvent,
  type GenerationRequest,
} from "@threadflow-os/contracts";

export class GatewayClient {
  #sessionToken: string | null = null;
  #pendingGeneration: Promise<{ id: string }> | null = null;

  constructor(
    private readonly baseUrl = "http://127.0.0.1:8787",
    private readonly getBootstrapSecret: () => Promise<string>,
  ) {}

  resetSession(): void {
    this.#sessionToken = null;
  }

  async status() {
    return AuthStatusSchema.parse(await this.request("/v1/auth/status"));
  }

  async login(type: "chatgpt" | "chatgptDeviceCode" = "chatgpt") {
    return this.request("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ type }),
    });
  }

  async logout() {
    await this.request("/v1/auth/logout", { method: "POST" });
  }

  createGeneration(request: GenerationRequest): Promise<{ id: string }> {
    if (this.#pendingGeneration) return this.#pendingGeneration;
    const pending = this.request("/v1/generations", {
      method: "POST",
      body: JSON.stringify(request),
    }) as Promise<{ id: string }>;
    this.#pendingGeneration = pending.finally(() => {
      if (this.#pendingGeneration === guarded) this.#pendingGeneration = null;
    });
    const guarded = this.#pendingGeneration;
    return guarded;
  }

  async cancelGeneration(id: string): Promise<void> {
    await this.request(`/v1/generations/${id}/cancel`, { method: "POST" });
  }

  async reviseGeneration(
    id: string,
    scope: "hook" | "cta" | "full",
    feedback: string,
  ) {
    const result = (await this.request(`/v1/generations/${id}/revisions`, {
      method: "POST",
      body: JSON.stringify({ scope, feedback }),
    })) as { finalDraft: unknown };
    return FinalDraftSchema.parse(result.finalDraft);
  }

  async *events(
    id: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GenerationEvent> {
    await this.ensureSession();
    const response = await fetch(
      `${this.baseUrl}/v1/generations/${id}/events`,
      {
        headers: { authorization: `Bearer ${this.#sessionToken}` },
        ...(signal ? { signal } : {}),
      },
    );
    if (!response.ok || !response.body) throw await gatewayError(response);
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data) yield GenerationEventSchema.parse(JSON.parse(data));
        boundary = buffer.indexOf("\n\n");
      }
    }
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    await this.ensureSession();
    const execute = () =>
      fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...init.headers,
          authorization: `Bearer ${this.#sessionToken}`,
        },
      });
    let response = await execute();
    if (response.status === 401) {
      this.#sessionToken = null;
      await this.ensureSession();
      response = await execute();
    }
    if (!response.ok) throw await gatewayError(response);
    return response.status === 204 ? undefined : response.json();
  }

  private async ensureSession(): Promise<void> {
    if (this.#sessionToken) return;
    const secret = await this.getBootstrapSecret();
    if (!secret) throw new Error("Companion 연결 키를 설정하세요.");
    const response = await fetch(`${this.baseUrl}/v1/session/bootstrap`, {
      method: "POST",
      headers: { "x-threadflow-bootstrap": secret },
    });
    if (!response.ok) throw await gatewayError(response);
    const token = ((await response.json()) as { token?: unknown }).token;
    if (typeof token !== "string" || !token)
      throw new Error("Companion이 올바른 세션을 반환하지 않았습니다.");
    this.#sessionToken = token;
  }
}

async function gatewayError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => ({}))) as any;
  const error = new Error(
    payload?.error?.message ?? `Gateway request failed (${response.status})`,
  );
  Object.assign(error, {
    code: payload?.error?.code,
    retryable: payload?.error?.retryable,
  });
  return error;
}
