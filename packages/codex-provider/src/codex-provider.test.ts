import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  AppServerClient,
  CodexProviderAdapter,
  type AppServerTransport,
  type RpcMessage,
} from "./index.js";

class FakeTransport implements AppServerTransport {
  readonly events = new EventEmitter();
  running = false;
  sent: RpcMessage[] = [];

  constructor(private readonly turnOutputs = ['{"ok":true}']) {}

  async start() {
    this.running = true;
  }
  send(message: RpcMessage) {
    this.sent.push(message);
    queueMicrotask(() => this.respond(message));
  }
  async stop() {
    this.running = false;
  }
  isRunning() {
    return this.running;
  }
  private respond(message: RpcMessage) {
    if (message.id === undefined) return;
    const method = message.method;
    if (method === "initialize")
      return this.result(message.id, { userAgent: "Codex/0.145.0" });
    if (method === "account/read")
      return this.result(message.id, {
        account: { type: "chatgpt", planType: "pro" },
        requiresOpenaiAuth: true,
      });
    if (method === "account/rateLimits/read")
      return this.result(message.id, {
        rateLimits: {
          primary: { usedPercent: 10, resetsAt: 1 },
          secondary: null,
        },
      });
    if (method === "account/login/start")
      return this.result(message.id, {
        type: "chatgpt",
        loginId: "login-1",
        authUrl: "https://auth.openai.com/",
      });
    if (method === "account/login/cancel")
      return this.result(message.id, { status: "canceled" });
    if (method === "account/logout") return this.result(message.id, {});
    if (method === "thread/start")
      return this.result(message.id, { thread: { id: "thread-1" } });
    if (method === "turn/start") {
      this.result(message.id, { turn: { id: "turn-1" } });
      queueMicrotask(() => {
        this.events.emit("message", {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            delta: this.turnOutputs.shift() ?? '{"ok":true}',
          },
        });
        this.events.emit("message", {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { id: "turn-1", status: "completed" },
          },
        });
      });
      return;
    }
    this.result(message.id, {});
  }
  private result(id: string | number, result: unknown) {
    this.events.emit("message", { id, result });
  }
}

describe("Codex App Server adapter", () => {
  it("normalizes account status without exposing token fields", async () => {
    const transport = new FakeTransport();
    const adapter = new CodexProviderAdapter(new AppServerClient(transport), {
      cwd: process.cwd(),
    });
    const status = await adapter.getAuthStatus();
    expect(status).toMatchObject({
      authenticated: true,
      accountType: "chatgpt",
      planType: "pro",
    });
    expect(status).not.toHaveProperty("accessToken");
    await adapter.close();
  });

  it("starts a read-only tool-free ephemeral thread and reads streamed JSON", async () => {
    const transport = new FakeTransport();
    const adapter = new CodexProviderAdapter(new AppServerClient(transport), {
      cwd: process.cwd(),
    });
    await adapter.initialize();
    const session = adapter.createGenerationProvider();
    await expect(
      session.generateJson({
        stage: "ANALYZING",
        prompt: "test",
        schema: { type: "object" },
      }),
    ).resolves.toEqual({ ok: true });
    const threadStart = transport.sent.find(
      (message) => message.method === "thread/start",
    );
    expect(threadStart?.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "read-only",
      environments: [],
      dynamicTools: [],
    });
    await adapter.close();
  });

  it("fails pending requests when the app server exits", async () => {
    const transport = new FakeTransport();
    const client = new AppServerClient(transport, 1_000);
    await client.initialize();
    const pending = client.request("never/responds");
    transport.events.emit("exit", new Error("forced exit"));
    await expect(pending).rejects.toThrow("forced exit");
  });

  it("rejects immediately when a request cannot be written to the app server", async () => {
    const transport = new FakeTransport();
    transport.send = () => {
      throw new Error("write failed");
    };
    const client = new AppServerClient(transport, 10_000);
    await expect(client.request("test")).rejects.toThrow("write failed");
  });

  it("times out a started turn that never completes", async () => {
    const transport = new FakeTransport();
    const originalSend = transport.send.bind(transport);
    transport.send = (message) => {
      if (message.method === "turn/start") {
        transport.sent.push(message);
        queueMicrotask(() =>
          transport.events.emit("message", {
            id: message.id,
            result: { turn: { id: "turn-stuck" } },
          }),
        );
        return;
      }
      originalSend(message);
    };
    const adapter = new CodexProviderAdapter(new AppServerClient(transport), {
      cwd: process.cwd(),
      maxSchemaRepairs: 0,
      turnTimeoutMs: 10,
    });
    const session = adapter.createGenerationProvider();
    await expect(
      session.generateJson({
        stage: "ANALYZING",
        prompt: "test",
        schema: { type: "object" },
      }),
    ).rejects.toThrow("timed out");
    await adapter.close();
  });

  it("does not misclassify provider failures as schema repair requests", async () => {
    const transport = new FakeTransport();
    const originalSend = transport.send.bind(transport);
    transport.send = (message) => {
      if (message.method === "turn/start") {
        transport.sent.push(message);
        queueMicrotask(() => {
          transport.events.emit("message", {
            id: message.id,
            result: { turn: { id: "turn-rate-limited" } },
          });
          queueMicrotask(() =>
            transport.events.emit("message", {
              method: "turn/completed",
              params: {
                threadId: "thread-1",
                turn: {
                  id: "turn-rate-limited",
                  status: "failed",
                  error: { message: "RATE_LIMITED: try later" },
                },
              },
            }),
          );
        });
        return;
      }
      originalSend(message);
    };
    const adapter = new CodexProviderAdapter(new AppServerClient(transport), {
      cwd: process.cwd(),
      maxSchemaRepairs: 2,
    });
    const session = adapter.createGenerationProvider();
    await expect(
      session.generateJson({
        stage: "ANALYZING",
        prompt: "test",
        schema: { type: "object" },
      }),
    ).rejects.toThrow("RATE_LIMITED");
    expect(
      transport.sent.filter((message) => message.method === "turn/start"),
    ).toHaveLength(1);
    await adapter.close();
  });

  it("forwards login, cancel and logout without exposing credentials", async () => {
    const transport = new FakeTransport();
    const adapter = new CodexProviderAdapter(new AppServerClient(transport), {
      cwd: process.cwd(),
    });
    await expect(adapter.login("chatgpt")).resolves.toMatchObject({
      loginId: "login-1",
    });
    await expect(adapter.cancelLogin("login-1")).resolves.toEqual({
      status: "canceled",
    });
    await adapter.logout();
    expect(transport.sent.map((message) => message.method)).toEqual(
      expect.arrayContaining([
        "account/login/start",
        "account/login/cancel",
        "account/logout",
      ]),
    );
    await adapter.close();
  });

  it("repairs malformed JSON in the same generation thread", async () => {
    const transport = new FakeTransport(["not-json", '{"ok":true}']);
    const adapter = new CodexProviderAdapter(new AppServerClient(transport), {
      cwd: process.cwd(),
      maxSchemaRepairs: 2,
    });
    const session = adapter.createGenerationProvider();
    await expect(
      session.generateJson({
        stage: "ANALYZING",
        prompt: "test",
        schema: { type: "object" },
      }),
    ).resolves.toEqual({ ok: true });
    expect(
      transport.sent.filter((message) => message.method === "thread/start"),
    ).toHaveLength(1);
    expect(
      transport.sent.filter((message) => message.method === "turn/start"),
    ).toHaveLength(2);
    await adapter.close();
  });
});
