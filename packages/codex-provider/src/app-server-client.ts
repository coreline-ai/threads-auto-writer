import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";

export type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
};

export interface AppServerTransport {
  readonly events: EventEmitter;
  start(): Promise<void>;
  send(message: RpcMessage): void;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export class StdioAppServerTransport implements AppServerTransport {
  readonly events = new EventEmitter();
  #child: ChildProcessWithoutNullStreams | null = null;
  #codexBin: string;
  #cwd: string;
  #codexHome: string | undefined;

  constructor(options: { codexBin?: string; cwd: string; codexHome?: string }) {
    this.#codexBin = options.codexBin ?? "codex";
    this.#cwd = options.cwd;
    this.#codexHome = options.codexHome;
  }

  async start(): Promise<void> {
    if (this.#child) return;
    if (this.#codexHome)
      mkdirSync(this.#codexHome, { recursive: true, mode: 0o700 });
    const child = spawn(
      this.#codexBin,
      ["app-server", "--listen", "stdio://"],
      {
        cwd: this.#cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          RUST_LOG: process.env.RUST_LOG ?? "warn",
          ...(this.#codexHome ? { CODEX_HOME: this.#codexHome } : {}),
        },
      },
    );
    this.#child = child;
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        this.events.emit("message", JSON.parse(line) as RpcMessage);
      } catch {
        this.events.emit(
          "protocol-error",
          new Error("Codex App Server emitted invalid JSON"),
        );
      }
    });
    child.stderr.on("data", (chunk) =>
      this.events.emit("diagnostic", String(chunk)),
    );
    child.once("error", (error) => this.events.emit("exit", error));
    child.once("exit", (code, signal) => {
      this.#child = null;
      this.events.emit(
        "exit",
        new Error(`Codex App Server exited (code=${code}, signal=${signal})`),
      );
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  }

  send(message: RpcMessage): void {
    if (!this.#child?.stdin.writable)
      throw new Error("Codex App Server is not running");
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
    this.#child = null;
  }

  isRunning(): boolean {
    return this.#child !== null;
  }
}

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class AppServerClient extends EventEmitter {
  #requestId = 0;
  #pending = new Map<string, Pending>();
  #initialized = false;
  #initializing: Promise<Record<string, unknown>> | null = null;

  constructor(
    private readonly transport: AppServerTransport,
    private readonly requestTimeoutMs = 120_000,
  ) {
    super();
    transport.events.on("message", (message: RpcMessage) =>
      this.handleMessage(message),
    );
    transport.events.on("exit", (error: Error) => this.failAll(error));
    transport.events.on("protocol-error", (error: Error) =>
      this.emit("protocol-error", error),
    );
    transport.events.on("diagnostic", (text: string) =>
      this.emit("diagnostic", text),
    );
  }

  async initialize(): Promise<Record<string, unknown>> {
    if (this.#initialized) return {};
    if (this.#initializing) return this.#initializing;
    const pending = (async () => {
      await this.transport.start();
      const result = await this.request<Record<string, unknown>>("initialize", {
        clientInfo: {
          name: "threadflow-os",
          title: "ThreadFlow OS",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      this.notify("initialized");
      this.#initialized = true;
      return result;
    })();
    this.#initializing = pending;
    try {
      return await pending;
    } finally {
      if (this.#initializing === pending) this.#initializing = null;
    }
  }

  request<T>(
    method: string,
    params?: unknown,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const id = ++this.#requestId;
    const message: RpcMessage = { id, method };
    if (params !== undefined) message.params = params;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(String(id));
        reject(new Error(`PROVIDER_UNAVAILABLE: ${method} timed out`));
      }, timeoutMs);
      this.#pending.set(String(id), { resolve, reject, timer });
      try {
        this.transport.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(String(id));
        reject(
          error instanceof Error
            ? error
            : new Error("Codex App Server request could not be sent"),
        );
      }
    });
  }

  notify(method: string, params?: unknown): void {
    const message: RpcMessage = { method };
    if (params !== undefined) message.params = params;
    this.transport.send(message);
  }

  async close(): Promise<void> {
    this.failAll(new Error("Codex App Server client closed"));
    this.#initialized = false;
    this.#initializing = null;
    await this.transport.stop();
  }

  isRunning(): boolean {
    return this.transport.isRunning();
  }

  private handleMessage(message: RpcMessage): void {
    if (message.id !== undefined && !message.method) {
      const pending = this.#pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(String(message.id));
      if (message.error)
        pending.reject(
          new Error(`${message.error.code}: ${message.error.message}`),
        );
      else pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method) {
      this.denyServerRequest(message);
      return;
    }

    if (message.method) this.emit("notification", message);
  }

  private denyServerRequest(message: RpcMessage): void {
    const method = message.method ?? "";
    let result: unknown = { decision: "decline" };
    if (method.includes("requestUserInput")) result = { answers: {} };
    this.transport.send({ id: message.id!, result });
    this.emit("denied-request", { method });
  }

  private failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.emit("unavailable", error);
  }
}
