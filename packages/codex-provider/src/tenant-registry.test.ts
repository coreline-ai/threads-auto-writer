import { describe, expect, it } from "vitest";
import { TenantCodexProviderRegistry } from "./tenant-registry.js";

describe("tenant Codex provider registry", () => {
  it("assigns a distinct opaque CODEX_HOME to each user", () => {
    const registry = new TenantCodexProviderRegistry({
      authRoot: "/tmp/threadflow-auth",
      cwd: "/tmp",
    });
    const a = registry.codexHomeFor({
      tenantId: "tenant-a",
      workspaceId: "w",
      userId: "user-a",
      role: "owner",
    });
    const b = registry.codexHomeFor({
      tenantId: "tenant-a",
      workspaceId: "w",
      userId: "user-b",
      role: "editor",
    });
    expect(a).not.toBe(b);
    expect(a).not.toContain("user-a");
    expect(b).not.toContain("user-b");
  });
});
