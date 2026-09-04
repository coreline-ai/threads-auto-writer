import { resolve } from "node:path";
import type { WorkspaceContext } from "@threadflow-os/contracts";
import { sha256 } from "@threadflow-os/shared";
import {
  AppServerClient,
  StdioAppServerTransport,
} from "./app-server-client.js";
import { CodexProviderAdapter } from "./provider.js";

export class TenantCodexProviderRegistry {
  readonly #providers = new Map<string, CodexProviderAdapter>();

  constructor(
    private readonly options: {
      authRoot: string;
      cwd: string;
      codexBin?: string;
      model?: string;
    },
  ) {}

  get(context: WorkspaceContext): CodexProviderAdapter {
    const key = providerKey(context);
    const existing = this.#providers.get(key);
    if (existing) return existing;
    const transport = new StdioAppServerTransport({
      cwd: this.options.cwd,
      codexHome: this.codexHomeFor(context),
      ...(this.options.codexBin ? { codexBin: this.options.codexBin } : {}),
    });
    const provider = new CodexProviderAdapter(new AppServerClient(transport), {
      cwd: this.options.cwd,
      ...(this.options.model ? { model: this.options.model } : {}),
    });
    this.#providers.set(key, provider);
    return provider;
  }

  codexHomeFor(context: WorkspaceContext): string {
    return resolve(
      this.options.authRoot,
      sha256(`${context.tenantId}\0${context.userId}`).slice(0, 32),
    );
  }

  async closeUser(context: WorkspaceContext): Promise<void> {
    const key = providerKey(context);
    const provider = this.#providers.get(key);
    this.#providers.delete(key);
    await provider?.close();
  }

  async closeAll(): Promise<void> {
    const providers = [...this.#providers.values()];
    this.#providers.clear();
    await Promise.all(providers.map((provider) => provider.close()));
  }
}

function providerKey(context: WorkspaceContext): string {
  return `${context.tenantId}:${context.userId}`;
}
