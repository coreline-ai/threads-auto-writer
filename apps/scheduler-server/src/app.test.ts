import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovedDraftSync,
  FinalDraft,
  WorkspaceContext,
} from "@threadflow-os/contracts";
import { ThreadFlowRepository } from "@threadflow-os/database";
import { AesGcmVault } from "@threadflow-os/shared";
import {
  ThreadsApiClient,
  ThreadsApiError,
} from "@threadflow-os/threads-client";
import { buildScheduler } from "./app.js";
import { PublishWorker } from "./worker.js";

const context: WorkspaceContext = {
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  userId: "user-a",
  role: "owner",
};
const draft: FinalDraft = {
  id: "draft-a",
  generationId: "g",
  selectedCandidateId: "c",
  text: "승인된 글",
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
  createdAt: new Date().toISOString(),
  approvedAt: new Date().toISOString(),
};

function setup() {
  const repository = new ThreadFlowRepository();
  repository.bootstrapWorkspace({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    userId: context.userId,
    name: "A",
    email: "a@example.com",
  });
  const vault = new AesGcmVault(randomBytes(32).toString("base64"));
  const client = new ThreadsApiClient(
    {
      appId: "app",
      appSecret: "secret",
      redirectUri: "http://localhost/callback",
      graphBaseUrl: "https://graph.threads.net/v1.0",
    },
    vi.fn(),
  );
  return { repository, vault, client };
}

describe("scheduler API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("binds OAuth to the configured callback and ignores request redirect input", async () => {
    const { repository, vault, client } = setup();
    const app = await buildScheduler({
      repository,
      threadsClient: client,
      vault,
      accessKeys: new Map([["key-a", context]]),
      oauthRedirectUri: "http://localhost/callback",
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/threads/oauth/start",
      headers: { authorization: "Bearer key-a" },
      payload: { redirectUri: "https://attacker.example/callback" },
    });
    expect(response.statusCode).toBe(200);
    const authUrl = new URL(response.json<{ authUrl: string }>().authUrl);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "http://localhost/callback",
    );
    expect(authUrl.searchParams.get("state")?.length).toBeGreaterThan(30);
    await app.close();
    repository.close();
  });

  it("stores only a long-lived user token, lists safe account metadata, and reconnects safely", async () => {
    const { repository, vault, client } = setup();
    vi.spyOn(client, "exchangeCode")
      .mockResolvedValueOnce({ access_token: "short-1", user_id: "threads-a" })
      .mockResolvedValueOnce({ access_token: "short-2", user_id: "threads-a" });
    vi.spyOn(client, "exchangeLongLivedToken")
      .mockResolvedValueOnce({
        access_token: "long-1",
        expires_in: 5_184_000,
        token_type: "bearer",
      })
      .mockResolvedValueOnce({
        access_token: "long-2",
        expires_in: 5_184_000,
        token_type: "bearer",
      });
    vi.spyOn(client, "getProfile").mockResolvedValue({
      id: "threads-a",
      username: "writer",
    });
    const app = await buildScheduler({
      repository,
      threadsClient: client,
      vault,
      accessKeys: new Map([["key-a", context]]),
    });

    const connect = async (code: string) => {
      const start = await app.inject({
        method: "POST",
        url: "/v1/threads/oauth/start",
        headers: { authorization: "Bearer key-a" },
      });
      const state = new URL(
        start.json<{ authUrl: string }>().authUrl,
      ).searchParams.get("state")!;
      return app.inject({
        method: "GET",
        url: `/v1/threads/oauth/callback?state=${encodeURIComponent(state)}&code=${code}`,
      });
    };

    expect((await connect("code-1")).statusCode).toBe(200);
    const firstList = await app.inject({
      method: "GET",
      url: "/v1/threads/accounts",
      headers: { authorization: "Bearer key-a" },
    });
    const firstAccount = firstList.json<Array<{ id: string }>>()[0]!;
    expect(JSON.stringify(firstList.json())).not.toContain("tokenCiphertext");
    let stored = repository.getThreadsAccountInternal(firstAccount.id)!;
    expect(
      vault.decrypt(stored.tokenCiphertext, `${context.tenantId}:${stored.id}`),
    ).toBe("long-1");
    repository.setPaused("account", firstAccount.id, true);
    const pausedList = await app.inject({
      method: "GET",
      url: "/v1/threads/accounts",
      headers: { authorization: "Bearer key-a" },
    });
    expect(pausedList.json<Array<{ paused: boolean }>>()[0]!.paused).toBe(true);

    expect((await connect("code-2")).statusCode).toBe(200);
    const secondList = await app.inject({
      method: "GET",
      url: "/v1/threads/accounts",
      headers: { authorization: "Bearer key-a" },
    });
    expect(secondList.json<Array<{ id: string }>>()).toHaveLength(1);
    expect(secondList.json<Array<{ id: string }>>()[0]!.id).toBe(
      firstAccount.id,
    );
    expect(secondList.json<Array<{ paused: boolean }>>()[0]!.paused).toBe(
      false,
    );
    stored = repository.getThreadsAccountInternal(firstAccount.id)!;
    expect(
      vault.decrypt(stored.tokenCiphertext, `${context.tenantId}:${stored.id}`),
    ).toBe("long-2");

    await app.close();
    repository.close();
  });

  it("requires user-specific auth and isolates job reads", async () => {
    const { repository, vault, client } = setup();
    const app = await buildScheduler({
      repository,
      threadsClient: client,
      vault,
      accessKeys: new Map([["key-a", context]]),
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/controls/global",
          payload: { paused: true },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/controls/global",
          headers: { authorization: "Bearer key-a" },
          payload: { paused: true },
        })
      ).statusCode,
    ).toBe(200);
    const controls = await app.inject({
      method: "GET",
      url: "/v1/controls",
      headers: { authorization: "Bearer key-a" },
    });
    expect(controls.json()).toMatchObject({
      workspacePaused: true,
      systemPaused: false,
    });
    const invalidBoolean = await app.inject({
      method: "POST",
      url: "/v1/controls/global",
      headers: { authorization: "Bearer key-a" },
      payload: { paused: "false" },
    });
    expect(invalidBoolean.statusCode).toBe(400);
    expect(invalidBoolean.json()).toMatchObject({
      error: { code: "INVALID_PAUSE_VALUE" },
    });
    await app.close();
    repository.close();
  });

  it("rejects a long-lived token response without an expiry", async () => {
    const { repository, vault, client } = setup();
    vi.spyOn(client, "exchangeCode").mockResolvedValue({
      access_token: "short",
      user_id: "threads-a",
    });
    vi.spyOn(client, "exchangeLongLivedToken").mockResolvedValue({
      access_token: "not-long-lived",
    });
    vi.spyOn(client, "getProfile").mockResolvedValue({
      id: "threads-a",
      username: "writer",
    });
    const app = await buildScheduler({
      repository,
      threadsClient: client,
      vault,
      accessKeys: new Map([["key-a", context]]),
    });
    const start = await app.inject({
      method: "POST",
      url: "/v1/threads/oauth/start",
      headers: { authorization: "Bearer key-a" },
    });
    const state = new URL(
      start.json<{ authUrl: string }>().authUrl,
    ).searchParams.get("state")!;
    const callback = await app.inject({
      method: "GET",
      url: `/v1/threads/oauth/callback?state=${encodeURIComponent(state)}&code=code`,
    });
    expect(callback.statusCode).toBe(502);
    expect(repository.listThreadsAccounts(context)).toHaveLength(0);
    expect(client.getProfile).not.toHaveBeenCalled();
    await app.close();
    repository.close();
  });

  it("validates past, timezone, DST, and same-instant schedule boundaries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-09-04T12:00:00.000Z").getTime(),
    );
    const { repository, vault, client } = setup();
    const accountId = "account-a";
    repository.upsertThreadsAccount(context, {
      id: accountId,
      threadsUserId: "threads-a",
      tokenCiphertext: vault.encrypt(
        "token",
        `${context.tenantId}:${accountId}`,
      ),
    });
    const version = repository.saveDraftVersion(context, draft);
    const app = await buildScheduler({
      repository,
      threadsClient: client,
      vault,
      accessKeys: new Map([["key-a", context]]),
    });
    const sync = (scheduledAt: string): ApprovedDraftSync => ({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      threadsAccountId: accountId,
      draft,
      scheduledAt,
      timezone: "Asia/Seoul",
      imageUrl: null,
      altText: null,
    });
    const future = await app.inject({
      method: "POST",
      url: "/v1/publish-jobs",
      headers: { authorization: "Bearer key-a" },
      payload: {
        sync: sync(new Date(Date.now() + 60_000).toISOString()),
        accountId,
        draftVersion: version,
        idempotencyKey: "idem-001",
      },
    });
    expect(future.statusCode).toBe(201);
    const futureJobId = future.json<{ id: string }>().id;

    const mismatchedDraftPath = await app.inject({
      method: "POST",
      url: "/v1/drafts/not-the-approved-id/versions",
      headers: { authorization: "Bearer key-a" },
      payload: { draft },
    });
    expect(mismatchedDraftPath.statusCode).toBe(400);

    const mismatchedAccount = await app.inject({
      method: "POST",
      url: "/v1/publish-jobs",
      headers: { authorization: "Bearer key-a" },
      payload: {
        sync: sync(new Date(Date.now() + 90_000).toISOString()),
        accountId: "another-account",
        draftVersion: version,
        idempotencyKey: "idem-account-mismatch",
      },
    });
    expect(mismatchedAccount.statusCode).toBe(400);

    const changedAfterApproval = await app.inject({
      method: "POST",
      url: "/v1/publish-jobs",
      headers: { authorization: "Bearer key-a" },
      payload: {
        sync: {
          ...sync(new Date(Date.now() + 90_000).toISOString()),
          draft: { ...draft, text: "승인 뒤 바뀐 글" },
        },
        accountId,
        draftVersion: version,
        idempotencyKey: "idem-changed-after-approval",
      },
    });
    expect(changedAfterApproval.statusCode).toBe(400);

    const schedule = async (
      id: string,
      text: string,
      scheduledAt: string,
      timezone: string,
    ) => {
      const scheduledDraft = { ...draft, id, text };
      const scheduledVersion = repository.saveDraftVersion(
        context,
        scheduledDraft,
      );
      return app.inject({
        method: "POST",
        url: "/v1/publish-jobs",
        headers: { authorization: "Bearer key-a" },
        payload: {
          sync: {
            ...sync(scheduledAt),
            draft: scheduledDraft,
            timezone,
          },
          accountId,
          draftVersion: scheduledVersion,
          idempotencyKey: `schedule-${id}`,
        },
      });
    };

    // New York의 DST 종료일에는 01:30이 두 번 발생한다. API 경계에서는
    // offset이 포함된 UTC instant로 둘을 구분하고 IANA zone은 표시 메타데이터다.
    expect(
      (
        await schedule(
          "draft-dst-first",
          "DST 첫 번째 01:30",
          "2026-11-01T05:30:00.000Z",
          "America/New_York",
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await schedule(
          "draft-dst-second",
          "DST 두 번째 01:30",
          "2026-11-01T06:30:00.000Z",
          "America/New_York",
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await schedule(
          "draft-same-instant",
          "같은 UTC 시각의 별도 승인 글",
          "2026-11-01T05:30:00.000Z",
          "America/New_York",
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await schedule(
          "draft-invalid-zone",
          "잘못된 시간대",
          "2026-11-02T05:30:00.000Z",
          "Mars/Olympus_Mons",
        )
      ).json(),
    ).toMatchObject({ error: { code: "INVALID_TIMEZONE" } });

    const unmanagedImage = await app.inject({
      method: "POST",
      url: "/v1/publish-jobs",
      headers: { authorization: "Bearer key-a" },
      payload: {
        sync: {
          ...sync(new Date(Date.now() + 120_000).toISOString()),
          imageUrl: "https://media.example.test/image.jpg",
        },
        accountId,
        draftVersion: version,
        idempotencyKey: "i-unmanaged-media",
      },
    });
    expect(unmanagedImage.statusCode).toBe(400);
    const past = await app.inject({
      method: "POST",
      url: "/v1/publish-jobs",
      headers: { authorization: "Bearer key-a" },
      payload: {
        sync: sync(new Date(Date.now() - 60_000).toISOString()),
        accountId,
        draftVersion: version,
        idempotencyKey: "idem-002",
      },
    });
    expect(past.statusCode).toBe(400);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/publish-jobs",
      headers: { authorization: "Bearer key-a" },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed
        .json<Array<{ id: string }>>()
        .some((job) => job.id === futureJobId),
    ).toBe(true);
    const canceled = await app.inject({
      method: "POST",
      url: `/v1/publish-jobs/${futureJobId}/cancel`,
      headers: { authorization: "Bearer key-a" },
    });
    expect(canceled.json()).toMatchObject({ state: "CANCELED" });
    const canceledAgain = await app.inject({
      method: "POST",
      url: `/v1/publish-jobs/${futureJobId}/cancel`,
      headers: { authorization: "Bearer key-a" },
    });
    expect(canceledAgain.statusCode).toBe(409);
    await app.close();
    repository.close();
  });

  it("collects published post insights without crossing workspace boundaries", async () => {
    const { repository, vault } = setup();
    const accountId = "account-insights";
    repository.upsertThreadsAccount(context, {
      id: accountId,
      threadsUserId: "threads-insights",
      tokenCiphertext: vault.encrypt(
        "token",
        `${context.tenantId}:${accountId}`,
      ),
    });
    const version = repository.saveDraftVersion(context, draft);
    const job = repository.createPublishJob(
      context,
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        threadsAccountId: accountId,
        draft,
        scheduledAt: new Date(Date.now() - 1_000).toISOString(),
        timezone: "UTC",
        imageUrl: null,
        altText: null,
      },
      accountId,
      version,
      "insights-job",
    );
    const leased = repository.leaseNextDueJob("insights-worker");
    expect(leased?.id).toBe(job.id);
    repository.markPublished(job.id, "insights-worker", "post-insights");
    const getInsights = vi.fn().mockResolvedValue({
      data: [
        { name: "views", values: [{ value: 123 }] },
        { name: "likes", values: [{ value: 9 }] },
      ],
    });
    const client = { getInsights } as unknown as ThreadsApiClient;
    const app = await buildScheduler({
      repository,
      threadsClient: client,
      vault,
      accessKeys: new Map([["key-a", context]]),
    });
    const refreshed = await app.inject({
      method: "POST",
      url: `/v1/publish-jobs/${job.id}/insights/refresh`,
      headers: { authorization: "Bearer key-a" },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().metrics).toEqual({ views: 123, likes: 9 });
    const stored = await app.inject({
      method: "GET",
      url: `/v1/publish-jobs/${job.id}/insights`,
      headers: { authorization: "Bearer key-a" },
    });
    expect(stored.json()).toHaveLength(2);
    expect(getInsights).toHaveBeenCalledWith("post-insights", "token", [
      "views",
      "likes",
      "replies",
      "reposts",
      "quotes",
      "shares",
    ]);
    await app.close();
    repository.close();
  });
});

describe("publish worker", () => {
  it("publishes a leased job exactly once", async () => {
    const { repository, vault } = setup();
    const accountId = "account-a";
    repository.upsertThreadsAccount(context, {
      id: accountId,
      threadsUserId: "threads-a",
      tokenCiphertext: vault.encrypt(
        "token",
        `${context.tenantId}:${accountId}`,
      ),
    });
    const version = repository.saveDraftVersion(context, draft);
    const sync: ApprovedDraftSync = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      threadsAccountId: accountId,
      draft,
      scheduledAt: new Date(Date.now() - 1_000).toISOString(),
      timezone: "UTC",
      imageUrl: null,
      altText: null,
    };
    const job = repository.createPublishJob(
      context,
      sync,
      accountId,
      version,
      "i-1",
    );
    const client = {
      refreshToken: vi.fn(),
      createContainer: vi.fn().mockResolvedValue({ id: "container-1" }),
      publish: vi.fn().mockResolvedValue({ id: "post-1" }),
    } as unknown as ThreadsApiClient;
    const worker = new PublishWorker({
      repository,
      client,
      vault,
      workerId: "worker-1",
    });
    expect(await worker.runOnce()).toBe(true);
    expect(repository.getJob(context, job.id)?.state).toBe("PUBLISHED");
    expect(await worker.runOnce()).toBe(false);
    expect((client.publish as any).mock.calls).toHaveLength(1);
    repository.close();
  });

  it("dead-letters an unknown publish outcome instead of posting twice", async () => {
    const { repository, vault } = setup();
    const accountId = "account-a";
    repository.upsertThreadsAccount(context, {
      id: accountId,
      threadsUserId: "threads-a",
      tokenCiphertext: vault.encrypt(
        "token",
        `${context.tenantId}:${accountId}`,
      ),
    });
    const version = repository.saveDraftVersion(context, draft);
    const sync: ApprovedDraftSync = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      threadsAccountId: accountId,
      draft,
      scheduledAt: new Date(Date.now() - 1_000).toISOString(),
      timezone: "UTC",
      imageUrl: null,
      altText: null,
    };
    const job = repository.createPublishJob(
      context,
      sync,
      accountId,
      version,
      "i-unknown",
    );
    const publish = vi
      .fn()
      .mockRejectedValue(
        new ThreadsApiError(
          "unknown",
          503,
          "PUBLISH_OUTCOME_UNKNOWN",
          false,
          true,
        ),
      );
    const client = {
      refreshToken: vi.fn(),
      createContainer: vi.fn().mockResolvedValue({ id: "container-1" }),
      publish,
    } as unknown as ThreadsApiClient;
    const worker = new PublishWorker({
      repository,
      client,
      vault,
      workerId: "worker-1",
    });
    await worker.runOnce();
    expect(repository.getJob(context, job.id)).toMatchObject({
      state: "DEAD_LETTER",
      lastErrorCode: "PUBLISH_OUTCOME_UNKNOWN",
    });
    expect(await worker.runOnce()).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    repository.close();
  });

  it("waits for image processing and revokes the temporary media URL", async () => {
    const { repository, vault } = setup();
    const accountId = "account-media";
    repository.upsertThreadsAccount(context, {
      id: accountId,
      threadsUserId: "threads-media",
      tokenCiphertext: vault.encrypt(
        "token",
        `${context.tenantId}:${accountId}`,
      ),
    });
    const version = repository.saveDraftVersion(context, draft);
    const imageUrl = "https://media.example.test/signed/image.jpg";
    const job = repository.createPublishJob(
      context,
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        threadsAccountId: accountId,
        draft,
        scheduledAt: new Date(Date.now() - 1_000).toISOString(),
        timezone: "UTC",
        imageUrl,
        altText: "설명",
        mediaExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      accountId,
      version,
      "media-job",
    );
    const getContainerStatus = vi
      .fn()
      .mockResolvedValueOnce({ id: "container-1", status: "IN_PROGRESS" })
      .mockResolvedValueOnce({ id: "container-1", status: "FINISHED" });
    const client = {
      refreshToken: vi.fn(),
      createContainer: vi.fn().mockResolvedValue({ id: "container-1" }),
      getContainerStatus,
      publish: vi.fn().mockResolvedValue({ id: "post-1" }),
    } as unknown as ThreadsApiClient;
    const revoke = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const worker = new PublishWorker({
      repository,
      client,
      vault,
      workerId: "worker-media",
      sleep,
      mediaLifecycle: { revoke },
    });
    await worker.runOnce();
    expect(repository.getJob(context, job.id)?.state).toBe("PUBLISHED");
    expect(getContainerStatus).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(revoke).toHaveBeenCalledWith(imageUrl);
    const expiredUrl = "https://media.example.test/signed/expired.jpg";
    const expired = repository.createPublishJob(
      context,
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        threadsAccountId: accountId,
        draft,
        scheduledAt: new Date(Date.now() - 1_000).toISOString(),
        timezone: "UTC",
        imageUrl: expiredUrl,
        altText: "만료 이미지",
        mediaExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
      accountId,
      version,
      "expired-media-job",
    );
    await worker.runOnce();
    expect(repository.getJob(context, expired.id)).toMatchObject({
      state: "DEAD_LETTER",
      lastErrorCode: "MEDIA_URL_EXPIRED",
    });
    expect(client.createContainer).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(expiredUrl);
    repository.close();
  });

  it("pauses only the affected account when Threads authorization is revoked", async () => {
    const { repository, vault } = setup();
    const accountId = "account-revoked";
    repository.upsertThreadsAccount(context, {
      id: accountId,
      threadsUserId: "threads-revoked",
      tokenCiphertext: vault.encrypt(
        "token",
        `${context.tenantId}:${accountId}`,
      ),
    });
    const version = repository.saveDraftVersion(context, draft);
    const job = repository.createPublishJob(
      context,
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        threadsAccountId: accountId,
        draft,
        scheduledAt: new Date(Date.now() - 1_000).toISOString(),
        timezone: "UTC",
        imageUrl: null,
        altText: null,
      },
      accountId,
      version,
      "revoked-job",
    );
    const client = {
      refreshToken: vi.fn(),
      createContainer: vi
        .fn()
        .mockRejectedValue(new ThreadsApiError("expired", 401, "190", false)),
    } as unknown as ThreadsApiClient;
    const worker = new PublishWorker({
      repository,
      client,
      vault,
      workerId: "worker-revoked",
    });
    await worker.runOnce();
    expect(repository.getJob(context, job.id)).toMatchObject({
      state: "DEAD_LETTER",
      lastErrorCode: "190",
    });
    expect(repository.isPaused("account", accountId)).toBe(true);
    repository.close();
  });

  it("rejects an invalid refreshed token before creating a container", async () => {
    const { repository, vault } = setup();
    const accountId = "account-invalid-refresh";
    repository.upsertThreadsAccount(context, {
      id: accountId,
      threadsUserId: "threads-invalid-refresh",
      tokenCiphertext: vault.encrypt(
        "old-token",
        `${context.tenantId}:${accountId}`,
      ),
      tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const version = repository.saveDraftVersion(context, {
      ...draft,
      id: "draft-invalid-refresh",
    });
    const job = repository.createPublishJob(
      context,
      {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        threadsAccountId: accountId,
        draft: { ...draft, id: "draft-invalid-refresh" },
        scheduledAt: new Date(Date.now() - 1_000).toISOString(),
        timezone: "UTC",
        imageUrl: null,
        altText: null,
      },
      accountId,
      version,
      "invalid-refresh-job",
    );
    const createContainer = vi.fn();
    const client = {
      refreshToken: vi.fn().mockResolvedValue({ access_token: "" }),
      createContainer,
    } as unknown as ThreadsApiClient;
    const worker = new PublishWorker({
      repository,
      client,
      vault,
      workerId: "worker-invalid-refresh",
    });
    await worker.runOnce();
    expect(repository.getJob(context, job.id)).toMatchObject({
      state: "DEAD_LETTER",
      lastErrorCode: "INVALID_REFRESH_TOKEN",
    });
    expect(repository.isPaused("account", accountId)).toBe(true);
    expect(createContainer).not.toHaveBeenCalled();
    repository.close();
  });
});
