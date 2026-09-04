import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ApprovedDraftSync,
  FinalDraft,
  WorkspaceContext,
} from "@threadflow-os/contracts";
import { ThreadFlowRepository } from "./index.js";
import { AesGcmVault } from "@threadflow-os/shared";

const owner: WorkspaceContext = {
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  userId: "user-a",
  role: "owner",
};
const other: WorkspaceContext = {
  tenantId: "tenant-b",
  workspaceId: "workspace-b",
  userId: "user-b",
  role: "owner",
};
const draft: FinalDraft = {
  id: "draft-a",
  generationId: "generation-a",
  selectedCandidateId: "candidate-a",
  text: "승인된 게시물",
  score: {
    hook: 80,
    originality: 80,
    readability: 80,
    personaFit: 80,
    evidence: 80,
    cta: 80,
    policy: 80,
    total: 80,
  },
  riskFlags: [],
  approvalStatus: "APPROVED",
  promptVersion: "2.0.0",
  rubricVersion: "1.0.0",
  createdAt: "2026-09-04T00:00:00.000Z",
  approvedAt: "2026-09-04T00:01:00.000Z",
};

function setup() {
  const repository = new ThreadFlowRepository();
  repository.bootstrapWorkspace({
    tenantId: owner.tenantId,
    workspaceId: owner.workspaceId,
    userId: owner.userId,
    name: "A",
    email: "a@example.com",
  });
  repository.bootstrapWorkspace({
    tenantId: other.tenantId,
    workspaceId: other.workspaceId,
    userId: other.userId,
    name: "B",
    email: "b@example.com",
  });
  return repository;
}

describe("tenant-aware scheduler repository", () => {
  it("isolates account, draft, job and insight records across tenants", () => {
    const repository = setup();
    const accountId = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-a",
      tokenCiphertext: "cipher",
    });
    expect(repository.getThreadsAccount(owner, accountId)?.threadsUserId).toBe(
      "threads-a",
    );
    expect(repository.getThreadsAccount(other, accountId)).toBeNull();
    const version = repository.saveDraftVersion(owner, draft);
    const job = repository.createPublishJob(
      owner,
      {
        tenantId: owner.tenantId,
        workspaceId: owner.workspaceId,
        threadsAccountId: accountId,
        draft,
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        timezone: "UTC",
        imageUrl: null,
        altText: null,
      },
      accountId,
      version,
      "tenant-isolation",
    );
    repository.saveInsights({
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      accountId,
      jobId: job.id,
      metrics: { views: 1 },
    });
    expect(repository.listDraftVersions(other, draft.id)).toEqual([]);
    expect(repository.getJob(other, job.id)).toBeNull();
    expect(() => repository.listInsights(other, job.id)).toThrow("NOT_FOUND");
    repository.close();
  });

  it("consumes OAuth state once and rejects replay", () => {
    const repository = setup();
    repository.createOAuthState({
      stateHash: "hash",
      context: owner,
      verifierCiphertext: "cipher",
      redirectUri: "http://localhost/callback",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(repository.consumeOAuthState("hash")).not.toBeNull();
    expect(repository.consumeOAuthState("hash")).toBeNull();
    repository.close();
  });

  it("does not let a workspace overwrite another workspace account id", () => {
    const repository = setup();
    repository.upsertThreadsAccount(owner, {
      id: "shared-account-id",
      threadsUserId: "threads-a",
      tokenCiphertext: "cipher-a",
    });
    expect(() =>
      repository.upsertThreadsAccount(other, {
        id: "shared-account-id",
        threadsUserId: "threads-b",
        tokenCiphertext: "cipher-b",
      }),
    ).toThrow("FORBIDDEN");
    expect(
      repository.getThreadsAccountInternal("shared-account-id")
        ?.tokenCiphertext,
    ).toBe("cipher-a");
    repository.close();
  });

  it("leases a due job only once and honors global pause", () => {
    const repository = setup();
    const accountId = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-a",
      tokenCiphertext: "cipher",
    });
    const version = repository.saveDraftVersion(owner, draft);
    const sync: ApprovedDraftSync = {
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      threadsAccountId: accountId,
      draft,
      scheduledAt: new Date(Date.now() - 1_000).toISOString(),
      timezone: "Asia/Seoul",
      imageUrl: null,
      altText: null,
    };
    repository.createPublishJob(owner, sync, accountId, version, "idem-1");
    const leased = repository.leaseNextDueJob("worker-1");
    expect(leased?.state).toBe("LEASED");
    expect(repository.leaseNextDueJob("worker-2")).toBeNull();
    repository.setPaused("global", "all", true);
    expect(repository.leaseNextDueJob("worker-3")).toBeNull();
    repository.close();
  });

  it("keeps a workspace-wide pause isolated from another tenant", () => {
    const repository = setup();
    const accountA = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-a-paused-workspace",
      tokenCiphertext: "cipher-a",
    });
    const accountB = repository.upsertThreadsAccount(other, {
      threadsUserId: "threads-b-active-workspace",
      tokenCiphertext: "cipher-b",
    });
    const versionA = repository.saveDraftVersion(owner, {
      ...draft,
      id: "draft-workspace-a",
      text: "A workspace post",
    });
    const draftB = {
      ...draft,
      id: "draft-workspace-b",
      text: "B workspace post",
    };
    const versionB = repository.saveDraftVersion(other, draftB);
    const scheduledAt = new Date(Date.now() - 1_000).toISOString();
    repository.createPublishJob(
      owner,
      {
        tenantId: owner.tenantId,
        workspaceId: owner.workspaceId,
        threadsAccountId: accountA,
        draft: {
          ...draft,
          id: "draft-workspace-a",
          text: "A workspace post",
        },
        scheduledAt,
        timezone: "UTC",
        imageUrl: null,
        altText: null,
      },
      accountA,
      versionA,
      "workspace-pause-a",
    );
    repository.createPublishJob(
      other,
      {
        tenantId: other.tenantId,
        workspaceId: other.workspaceId,
        threadsAccountId: accountB,
        draft: draftB,
        scheduledAt,
        timezone: "UTC",
        imageUrl: null,
        altText: null,
      },
      accountB,
      versionB,
      "workspace-pause-b",
    );
    repository.setPaused(
      "global",
      `${owner.tenantId}:${owner.workspaceId}`,
      true,
    );
    expect(repository.leaseNextDueJob("worker")?.accountId).toBe(accountB);
    repository.close();
  });

  it("keeps an account pause isolated from another account", () => {
    const repository = setup();
    const pausedAccount = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-paused",
      tokenCiphertext: "cipher-a",
    });
    const activeAccount = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-active",
      tokenCiphertext: "cipher-b",
    });
    const version = repository.saveDraftVersion(owner, draft);
    const scheduledAt = new Date(Date.now() - 1_000).toISOString();
    const sync: ApprovedDraftSync = {
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      threadsAccountId: pausedAccount,
      draft,
      scheduledAt,
      timezone: "UTC",
      imageUrl: null,
      altText: null,
    };
    repository.createPublishJob(
      owner,
      sync,
      pausedAccount,
      version,
      "paused-job",
    );
    repository.createPublishJob(
      owner,
      { ...sync, threadsAccountId: activeAccount },
      activeAccount,
      version,
      "active-job",
    );
    repository.setPaused("account", pausedAccount, true);
    expect(repository.leaseNextDueJob("worker")?.accountId).toBe(activeAccount);
    repository.close();
  });

  it("cancels waiting jobs when their Threads account is disconnected", () => {
    const repository = setup();
    const accountId = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-disconnect",
      tokenCiphertext: "cipher",
    });
    const version = repository.saveDraftVersion(owner, draft);
    const job = repository.createPublishJob(
      owner,
      {
        tenantId: owner.tenantId,
        workspaceId: owner.workspaceId,
        threadsAccountId: accountId,
        draft,
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        timezone: "UTC",
        imageUrl: null,
        altText: null,
      },
      accountId,
      version,
      "disconnect-job",
    );
    repository.disconnectThreadsAccount(owner, accountId);
    expect(repository.getJob(owner, job.id)).toMatchObject({
      state: "CANCELED",
      lastErrorCode: "ACCOUNT_DISCONNECTED",
    });
    repository.close();
  });

  it("rejects duplicate active content", () => {
    const repository = setup();
    const accountId = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-a",
      tokenCiphertext: "cipher",
    });
    const version = repository.saveDraftVersion(owner, draft);
    const sync: ApprovedDraftSync = {
      tenantId: owner.tenantId,
      workspaceId: owner.workspaceId,
      threadsAccountId: accountId,
      draft,
      scheduledAt: new Date().toISOString(),
      timezone: "UTC",
      imageUrl: null,
      altText: null,
    };
    repository.createPublishJob(owner, sync, accountId, version, "idem-1");
    expect(() =>
      repository.createPublishJob(owner, sync, accountId, version, "idem-2"),
    ).toThrow();
    const editedDraft = {
      ...draft,
      id: "draft-edited",
      text: `${draft.text} 일부 수정`,
    };
    const editedVersion = repository.saveDraftVersion(owner, editedDraft);
    expect(
      repository.createPublishJob(
        owner,
        { ...sync, draft: editedDraft },
        accountId,
        editedVersion,
        "idem-3",
      ).state,
    ).toBe("SCHEDULED");
    repository.close();
  });

  it("rolls prompt versions back deterministically", () => {
    const repository = setup();
    repository.setPromptVersion(owner, "new", "2.0.0");
    repository.setPromptVersion(owner, "new", "2.1.0");
    expect(repository.rollbackPromptVersion(owner, "new")).toBe("2.0.0");
    repository.close();
  });

  it("rotates every connected Threads token transactionally", () => {
    const repository = setup();
    const oldVault = new AesGcmVault(randomBytes(32).toString("base64"));
    const newVault = new AesGcmVault(randomBytes(32).toString("base64"));
    const accountId = "account-rotate";
    repository.upsertThreadsAccount(owner, {
      id: accountId,
      threadsUserId: "threads-rotate",
      tokenCiphertext: oldVault.encrypt(
        "token-to-rotate",
        `${owner.tenantId}:${accountId}`,
      ),
    });
    expect(
      repository.rotateThreadsTokensInternal((ciphertext, associatedData) =>
        newVault.encrypt(
          oldVault.decrypt(ciphertext, associatedData),
          associatedData,
        ),
      ),
    ).toBe(1);
    const rotated = repository.getThreadsAccountInternal(accountId)!;
    expect(
      newVault.decrypt(
        rotated.tokenCiphertext,
        `${owner.tenantId}:${accountId}`,
      ),
    ).toBe("token-to-rotate");
    expect(() =>
      oldVault.decrypt(
        rotated.tokenCiphertext,
        `${owner.tenantId}:${accountId}`,
      ),
    ).toThrow();
    repository.close();
  });

  it("deletes one user's derived records without deleting another tenant", () => {
    const repository = setup();
    const a = repository.upsertThreadsAccount(owner, {
      threadsUserId: "threads-a",
      tokenCiphertext: "cipher-a",
    });
    const b = repository.upsertThreadsAccount(other, {
      threadsUserId: "threads-b",
      tokenCiphertext: "cipher-b",
    });
    repository.setPaused("account", a, true);
    repository.setPaused("account", b, true);
    repository.deleteUserData(owner);
    expect(repository.getThreadsAccountInternal(a)).toBeNull();
    expect(repository.isPaused("account", a)).toBe(false);
    expect(repository.getThreadsAccount(other, b)?.threadsUserId).toBe(
      "threads-b",
    );
    expect(repository.isPaused("account", b)).toBe(true);
    repository.close();
  });
});
