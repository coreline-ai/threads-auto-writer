import { DatabaseSync } from "node:sqlite";
import type {
  ApprovedDraftSync,
  FinalDraft,
  PublishJobState,
  WorkspaceContext,
} from "@threadflow-os/contracts";
import { createId, nowIso, sha256 } from "@threadflow-os/shared";
import { migrations } from "./migrations.js";

export type PublishJob = {
  id: string;
  tenantId: string;
  workspaceId: string;
  accountId: string;
  draftId: string;
  draftVersion: number;
  state: PublishJobState;
  scheduledAt: string;
  timezone: string;
  text: string;
  imageUrl: string | null;
  altText: string | null;
  mediaExpiresAt: string | null;
  contentHash: string;
  idempotencyKey: string;
  leaseOwner: string | null;
  leaseUntil: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  remoteContainerId: string | null;
  remotePostId: string | null;
  lastErrorCode: string | null;
};

export type ThreadsAccountRecord = {
  id: string;
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
  threadsUserId: string;
  username: string | null;
  tokenCiphertext: string;
  tokenExpiresAt: string | null;
  paused: boolean;
  disconnectedAt: string | null;
};

export type InsightRecord = {
  metric: string;
  value: number;
  measuredAt: string;
};

export class ThreadFlowRepository {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const appliedRows = this.db
      .prepare("SELECT version FROM schema_migrations")
      .all() as Array<{ version: number }>;
    const applied = new Set(appliedRows.map((row) => row.version));
    migrations.forEach((sql, index) => {
      const version = index + 1;
      if (applied.has(version)) return;
      this.transaction(() => {
        this.db.exec(sql);
        this.db
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
          )
          .run(version, nowIso());
      });
    });
  }

  bootstrapWorkspace(input: {
    tenantId: string;
    workspaceId: string;
    userId: string;
    role?: WorkspaceContext["role"];
    name: string;
    email: string;
  }): void {
    const now = nowIso();
    this.transaction(() => {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO tenants(id, name, created_at) VALUES (?, ?, ?)",
        )
        .run(input.tenantId, input.name, now);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO workspaces(id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(input.workspaceId, input.tenantId, input.name, now);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO users(id, tenant_id, email_hash, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          input.userId,
          input.tenantId,
          sha256(input.email.trim().toLowerCase()),
          now,
        );
      this.db
        .prepare(
          "INSERT OR IGNORE INTO workspace_members(tenant_id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          input.tenantId,
          input.workspaceId,
          input.userId,
          input.role ?? "owner",
          now,
        );
    });
  }

  assertMembership(
    context: WorkspaceContext,
    minimum: "viewer" | "editor" | "owner" = "viewer",
  ): void {
    const row = this.db
      .prepare(
        "SELECT role FROM workspace_members WHERE tenant_id = ? AND workspace_id = ? AND user_id = ?",
      )
      .get(context.tenantId, context.workspaceId, context.userId) as
      { role: WorkspaceContext["role"] } | undefined;
    const rank = { viewer: 0, editor: 1, owner: 2 };
    if (!row || rank[row.role] < rank[minimum])
      throw new Error("FORBIDDEN: workspace membership required");
  }

  upsertThreadsAccount(
    context: WorkspaceContext,
    input: {
      id?: string;
      threadsUserId: string;
      username?: string | null;
      tokenCiphertext: string;
      tokenExpiresAt?: string | null;
    },
  ): string {
    this.assertMembership(context, "editor");
    const now = nowIso();
    const existing = this.db
      .prepare(
        "SELECT id FROM threads_accounts WHERE tenant_id = ? AND workspace_id = ? AND threads_user_id = ?",
      )
      .get(context.tenantId, context.workspaceId, input.threadsUserId) as
      { id: string } | undefined;
    const id = existing?.id ?? input.id ?? createId("threads_account");
    const result = this.db
      .prepare(
        `INSERT INTO threads_accounts(
          id, tenant_id, workspace_id, owner_user_id, threads_user_id, username,
          token_ciphertext, token_expires_at, paused, disconnected_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          token_ciphertext = excluded.token_ciphertext,
          token_expires_at = excluded.token_expires_at,
          username = excluded.username,
          paused = 0,
          disconnected_at = NULL,
          updated_at = excluded.updated_at
        WHERE threads_accounts.tenant_id = excluded.tenant_id
          AND threads_accounts.workspace_id = excluded.workspace_id`,
      )
      .run(
        id,
        context.tenantId,
        context.workspaceId,
        context.userId,
        input.threadsUserId,
        input.username ?? null,
        input.tokenCiphertext,
        input.tokenExpiresAt ?? null,
        now,
        now,
      );
    if (!result.changes)
      throw new Error(
        "FORBIDDEN: Threads account ID belongs to another workspace",
      );
    this.audit(context, "threads_account.connected", "threads_account", id, {});
    return id;
  }

  getThreadsAccount(
    context: WorkspaceContext,
    accountId: string,
  ): ThreadsAccountRecord | null {
    this.assertMembership(context);
    const row = this.db
      .prepare(
        "SELECT * FROM threads_accounts WHERE id = ? AND tenant_id = ? AND workspace_id = ?",
      )
      .get(accountId, context.tenantId, context.workspaceId) as
      Record<string, unknown> | undefined;
    return row ? mapAccount(row) : null;
  }

  getThreadsAccountByThreadsUserId(
    context: WorkspaceContext,
    threadsUserId: string,
  ): ThreadsAccountRecord | null {
    this.assertMembership(context);
    const row = this.db
      .prepare(
        "SELECT * FROM threads_accounts WHERE threads_user_id = ? AND tenant_id = ? AND workspace_id = ?",
      )
      .get(threadsUserId, context.tenantId, context.workspaceId) as
      Record<string, unknown> | undefined;
    return row ? mapAccount(row) : null;
  }

  listThreadsAccounts(context: WorkspaceContext): ThreadsAccountRecord[] {
    this.assertMembership(context);
    const rows = this.db
      .prepare(
        "SELECT * FROM threads_accounts WHERE tenant_id = ? AND workspace_id = ? ORDER BY updated_at DESC",
      )
      .all(context.tenantId, context.workspaceId) as Array<
      Record<string, unknown>
    >;
    return rows.map(mapAccount);
  }

  getThreadsAccountInternal(accountId: string): ThreadsAccountRecord | null {
    const row = this.db
      .prepare("SELECT * FROM threads_accounts WHERE id = ?")
      .get(accountId) as Record<string, unknown> | undefined;
    return row ? mapAccount(row) : null;
  }

  updateThreadsTokenInternal(
    accountId: string,
    tokenCiphertext: string,
    tokenExpiresAt: string | null,
  ): void {
    const result = this.db
      .prepare(
        "UPDATE threads_accounts SET token_ciphertext = ?, token_expires_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(tokenCiphertext, tokenExpiresAt, nowIso(), accountId);
    if (!result.changes) throw new Error("NOT_FOUND: Threads account");
  }

  rotateThreadsTokensInternal(
    transform: (ciphertext: string, associatedData: string) => string,
  ): number {
    return this.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT id, tenant_id, token_ciphertext FROM threads_accounts
           WHERE disconnected_at IS NULL AND token_ciphertext <> ''`,
        )
        .all() as Array<{
        id: string;
        tenant_id: string;
        token_ciphertext: string;
      }>;
      const update = this.db.prepare(
        "UPDATE threads_accounts SET token_ciphertext = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
      );
      for (const row of rows) {
        update.run(
          transform(row.token_ciphertext, `${row.tenant_id}:${row.id}`),
          nowIso(),
          row.id,
          row.tenant_id,
        );
      }
      return rows.length;
    });
  }

  disconnectThreadsAccount(context: WorkspaceContext, accountId: string): void {
    this.assertMembership(context, "editor");
    this.transaction(() => {
      const now = nowIso();
      const result = this.db
        .prepare(
          `UPDATE threads_accounts SET token_ciphertext = '', disconnected_at = ?, paused = 1, updated_at = ?
           WHERE id = ? AND tenant_id = ? AND workspace_id = ?`,
        )
        .run(now, now, accountId, context.tenantId, context.workspaceId);
      if (!result.changes) throw new Error("NOT_FOUND: Threads account");
      this.db
        .prepare(
          `UPDATE publish_jobs
           SET state = 'CANCELED', last_error_code = 'ACCOUNT_DISCONNECTED',
               lease_owner = NULL, lease_until = NULL, updated_at = ?
           WHERE account_id = ? AND tenant_id = ? AND workspace_id = ?
             AND state IN ('SCHEDULED', 'RETRY_WAIT')`,
        )
        .run(now, accountId, context.tenantId, context.workspaceId);
      this.audit(
        context,
        "threads_account.disconnected",
        "threads_account",
        accountId,
        {},
      );
    });
  }

  saveDraftVersion(
    context: WorkspaceContext,
    draft: FinalDraft,
    parentVersion?: number,
  ): number {
    this.assertMembership(context, "editor");
    const current = this.db
      .prepare(
        "SELECT MAX(version) AS version FROM drafts WHERE id = ? AND tenant_id = ? AND workspace_id = ?",
      )
      .get(draft.id, context.tenantId, context.workspaceId) as {
      version: number | null;
    };
    const version = (current.version ?? 0) + 1;
    if (
      parentVersion !== undefined &&
      parentVersion !== (current.version ?? 0)
    ) {
      throw new Error("VERSION_CONFLICT: draft was changed by another editor");
    }
    this.db
      .prepare(
        `INSERT INTO drafts(id, version, tenant_id, workspace_id, owner_user_id, final_draft_json, content_hash, parent_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        draft.id,
        version,
        context.tenantId,
        context.workspaceId,
        context.userId,
        JSON.stringify(draft),
        sha256(draft.text),
        parentVersion ?? null,
        nowIso(),
      );
    return version;
  }

  listDraftVersions(
    context: WorkspaceContext,
    draftId: string,
  ): Array<{ version: number; draft: FinalDraft; createdAt: string }> {
    this.assertMembership(context);
    const rows = this.db
      .prepare(
        "SELECT version, final_draft_json, created_at FROM drafts WHERE id = ? AND tenant_id = ? AND workspace_id = ? ORDER BY version DESC",
      )
      .all(draftId, context.tenantId, context.workspaceId) as Array<{
      version: number;
      final_draft_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      version: row.version,
      draft: JSON.parse(row.final_draft_json) as FinalDraft,
      createdAt: row.created_at,
    }));
  }

  createPublishJob(
    context: WorkspaceContext,
    sync: ApprovedDraftSync,
    accountId: string,
    draftVersion: number,
    idempotencyKey: string,
  ): PublishJob {
    this.assertMembership(context, "editor");
    if (
      sync.tenantId !== context.tenantId ||
      sync.workspaceId !== context.workspaceId
    )
      throw new Error("FORBIDDEN: tenant mismatch");
    if (sync.threadsAccountId !== accountId)
      throw new Error("INVALID_ACCOUNT: account mismatch");
    if (sync.draft.approvalStatus !== "APPROVED")
      throw new Error("INVALID_DRAFT: approval required");
    const storedDraft = this.db
      .prepare(
        `SELECT final_draft_json, content_hash FROM drafts
         WHERE id = ? AND version = ? AND tenant_id = ? AND workspace_id = ?`,
      )
      .get(
        sync.draft.id,
        draftVersion,
        context.tenantId,
        context.workspaceId,
      ) as { final_draft_json: string; content_hash: string } | undefined;
    if (!storedDraft) throw new Error("NOT_FOUND: approved draft version");
    const storedFinalDraft = JSON.parse(
      storedDraft.final_draft_json,
    ) as FinalDraft;
    if (
      storedFinalDraft.approvalStatus !== "APPROVED" ||
      !storedFinalDraft.approvedAt ||
      storedDraft.content_hash !== sha256(sync.draft.text)
    )
      throw new Error("INVALID_DRAFT_VERSION: approved snapshot mismatch");
    const account = this.getThreadsAccount(context, accountId);
    if (!account || account.disconnectedAt)
      throw new Error("ACCOUNT_UNAVAILABLE");
    const now = nowIso();
    const id = createId("publish");
    this.db
      .prepare(
        `INSERT INTO publish_jobs(
          id, tenant_id, workspace_id, account_id, draft_id, draft_version, state, scheduled_at, timezone,
          text, image_url, alt_text, media_expires_at, content_hash, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        context.tenantId,
        context.workspaceId,
        accountId,
        sync.draft.id,
        draftVersion,
        sync.scheduledAt,
        sync.timezone,
        sync.draft.text,
        sync.imageUrl,
        sync.altText,
        sync.mediaExpiresAt ?? null,
        sha256(sync.draft.text),
        idempotencyKey,
        now,
        now,
      );
    this.audit(context, "publish_job.created", "publish_job", id, {
      scheduledAt: sync.scheduledAt,
    });
    return this.getJob(context, id)!;
  }

  getJob(context: WorkspaceContext, jobId: string): PublishJob | null {
    this.assertMembership(context);
    const row = this.db
      .prepare(
        "SELECT * FROM publish_jobs WHERE id = ? AND tenant_id = ? AND workspace_id = ?",
      )
      .get(jobId, context.tenantId, context.workspaceId) as
      Record<string, unknown> | undefined;
    return row ? mapJob(row) : null;
  }

  listPublishJobs(context: WorkspaceContext): PublishJob[] {
    this.assertMembership(context);
    const rows = this.db
      .prepare(
        `SELECT * FROM publish_jobs
         WHERE tenant_id = ? AND workspace_id = ?
         ORDER BY scheduled_at DESC, created_at DESC`,
      )
      .all(context.tenantId, context.workspaceId) as Array<
      Record<string, unknown>
    >;
    return rows.map(mapJob);
  }

  cancelPublishJob(context: WorkspaceContext, jobId: string): PublishJob {
    this.assertMembership(context, "editor");
    const job = this.getJob(context, jobId);
    if (!job) throw new Error("NOT_FOUND: publish job");
    const result = this.db
      .prepare(
        `UPDATE publish_jobs SET state = 'CANCELED', lease_owner = NULL, lease_until = NULL, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND workspace_id = ? AND state IN ('SCHEDULED', 'RETRY_WAIT')`,
      )
      .run(nowIso(), jobId, context.tenantId, context.workspaceId);
    if (!result.changes)
      throw new Error("JOB_NOT_CANCELABLE: publish already in progress");
    this.audit(context, "publish_job.canceled", "publish_job", jobId, {});
    return this.getJob(context, jobId)!;
  }

  leaseNextDueJob(
    workerId: string,
    now = new Date(),
    leaseMs = 60_000,
  ): PublishJob | null {
    if (this.isPaused("global", "all")) return null;
    return this.transaction(() => {
      const nowText = now.toISOString();
      const row = this.db
        .prepare(
          `SELECT j.* FROM publish_jobs j
           JOIN threads_accounts a ON a.id = j.account_id
           LEFT JOIN controls c ON c.scope = 'account' AND c.scope_id = a.id
           LEFT JOIN controls w ON w.scope = 'global'
             AND w.scope_id = j.tenant_id || ':' || j.workspace_id
           WHERE j.state IN ('SCHEDULED', 'RETRY_WAIT')
             AND j.scheduled_at <= ?
             AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
             AND (j.lease_until IS NULL OR j.lease_until < ?)
             AND a.paused = 0 AND a.disconnected_at IS NULL
             AND COALESCE(c.paused, 0) = 0
             AND COALESCE(w.paused, 0) = 0
           ORDER BY j.scheduled_at ASC LIMIT 1`,
        )
        .get(nowText, nowText, nowText) as Record<string, unknown> | undefined;
      if (!row) return null;
      const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
      const updated = this.db
        .prepare(
          `UPDATE publish_jobs SET state = 'LEASED', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND state IN ('SCHEDULED', 'RETRY_WAIT') AND (lease_until IS NULL OR lease_until < ?)`,
        )
        .run(workerId, leaseUntil, nowText, String(row.id), nowText);
      if (!updated.changes) return null;
      return mapJob({
        ...row,
        state: "LEASED",
        lease_owner: workerId,
        lease_until: leaseUntil,
        attempts: Number(row.attempts) + 1,
      });
    });
  }

  markPublishing(jobId: string, workerId: string, containerId?: string): void {
    const result = this.db
      .prepare(
        `UPDATE publish_jobs SET state = 'PUBLISHING', remote_container_id = COALESCE(?, remote_container_id), updated_at = ?
         WHERE id = ? AND state = 'LEASED' AND lease_owner = ?`,
      )
      .run(containerId ?? null, nowIso(), jobId, workerId);
    if (!result.changes) throw new Error("LEASE_LOST");
  }

  markPublished(jobId: string, workerId: string, postId: string): void {
    const result = this.db
      .prepare(
        `UPDATE publish_jobs SET state = 'PUBLISHED', remote_post_id = ?, lease_owner = NULL, lease_until = NULL,
         last_error_code = NULL, updated_at = ? WHERE id = ? AND state IN ('LEASED', 'PUBLISHING') AND lease_owner = ?`,
      )
      .run(postId, nowIso(), jobId, workerId);
    if (!result.changes) throw new Error("LEASE_LOST");
  }

  markRetry(
    jobId: string,
    workerId: string,
    errorCode: string,
    retryAt: Date,
    maxAttempts = 5,
  ): void {
    const row = this.db
      .prepare(
        "SELECT attempts FROM publish_jobs WHERE id = ? AND lease_owner = ?",
      )
      .get(jobId, workerId) as { attempts: number } | undefined;
    if (!row) throw new Error("LEASE_LOST");
    const state: PublishJobState =
      row.attempts >= maxAttempts ? "DEAD_LETTER" : "RETRY_WAIT";
    this.db
      .prepare(
        `UPDATE publish_jobs SET state = ?, next_attempt_at = ?, last_error_code = ?, lease_owner = NULL,
         lease_until = NULL, updated_at = ? WHERE id = ? AND lease_owner = ?`,
      )
      .run(
        state,
        retryAt.toISOString(),
        errorCode.slice(0, 120),
        nowIso(),
        jobId,
        workerId,
      );
  }

  markDeadLetter(jobId: string, workerId: string, errorCode: string): void {
    const result = this.db
      .prepare(
        `UPDATE publish_jobs SET state = 'DEAD_LETTER', last_error_code = ?, lease_owner = NULL,
         lease_until = NULL, updated_at = ? WHERE id = ? AND lease_owner = ?`,
      )
      .run(errorCode.slice(0, 120), nowIso(), jobId, workerId);
    if (!result.changes) throw new Error("LEASE_LOST");
  }

  recoverExpiredPublishing(now = new Date()): number {
    const result = this.db
      .prepare(
        `UPDATE publish_jobs SET state = 'DEAD_LETTER', last_error_code = 'PUBLISH_OUTCOME_UNKNOWN',
         lease_owner = NULL, lease_until = NULL, updated_at = ?
         WHERE state = 'PUBLISHING' AND lease_until IS NOT NULL AND lease_until < ?`,
      )
      .run(now.toISOString(), now.toISOString());
    return Number(result.changes);
  }

  saveInsights(input: {
    tenantId: string;
    workspaceId: string;
    accountId: string;
    jobId: string;
    metrics: Record<string, number>;
    measuredAt?: string;
  }): void {
    const measuredAt = input.measuredAt ?? nowIso();
    this.transaction(() => {
      for (const [metric, value] of Object.entries(input.metrics)) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO insights(id, tenant_id, workspace_id, account_id, job_id, metric, value, measured_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            createId("insight"),
            input.tenantId,
            input.workspaceId,
            input.accountId,
            input.jobId,
            metric,
            value,
            measuredAt,
          );
      }
    });
  }

  listInsights(context: WorkspaceContext, jobId: string): InsightRecord[] {
    this.assertMembership(context);
    const job = this.getJob(context, jobId);
    if (!job) throw new Error("NOT_FOUND: publish job");
    const rows = this.db
      .prepare(
        `SELECT metric, value, measured_at FROM insights
         WHERE tenant_id = ? AND workspace_id = ? AND job_id = ?
         ORDER BY measured_at DESC, metric ASC`,
      )
      .all(context.tenantId, context.workspaceId, jobId) as Array<{
      metric: string;
      value: number;
      measured_at: string;
    }>;
    return rows.map((row) => ({
      metric: row.metric,
      value: row.value,
      measuredAt: row.measured_at,
    }));
  }

  setPaused(
    scope: "global" | "account",
    scopeId: string,
    paused: boolean,
  ): void {
    this.db
      .prepare(
        `INSERT INTO controls(scope, scope_id, paused, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(scope, scope_id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`,
      )
      .run(scope, scopeId, paused ? 1 : 0, nowIso());
  }

  isPaused(scope: "global" | "account", scopeId: string): boolean {
    const row = this.db
      .prepare("SELECT paused FROM controls WHERE scope = ? AND scope_id = ?")
      .get(scope, scopeId) as { paused: number } | undefined;
    return row?.paused === 1;
  }

  createOAuthState(input: {
    stateHash: string;
    context: WorkspaceContext;
    verifierCiphertext: string;
    redirectUri: string;
    expiresAt: string;
  }): void {
    this.assertMembership(input.context, "editor");
    this.db
      .prepare(
        `INSERT INTO oauth_states(state_hash, tenant_id, workspace_id, user_id, verifier_ciphertext, redirect_uri, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.stateHash,
        input.context.tenantId,
        input.context.workspaceId,
        input.context.userId,
        input.verifierCiphertext,
        input.redirectUri,
        input.expiresAt,
        nowIso(),
      );
  }

  consumeOAuthState(
    stateHash: string,
    now = new Date(),
  ): {
    context: WorkspaceContext;
    verifierCiphertext: string;
    redirectUri: string;
  } | null {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT * FROM oauth_states WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?",
        )
        .get(stateHash, now.toISOString()) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      const result = this.db
        .prepare(
          "UPDATE oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL",
        )
        .run(now.toISOString(), stateHash);
      if (!result.changes) return null;
      const role = this.db
        .prepare(
          "SELECT role FROM workspace_members WHERE tenant_id = ? AND workspace_id = ? AND user_id = ?",
        )
        .get(
          String(row.tenant_id),
          String(row.workspace_id),
          String(row.user_id),
        ) as { role: WorkspaceContext["role"] } | undefined;
      if (!role) return null;
      return {
        context: {
          tenantId: String(row.tenant_id),
          workspaceId: String(row.workspace_id),
          userId: String(row.user_id),
          role: role.role,
        },
        verifierCiphertext: String(row.verifier_ciphertext),
        redirectUri: String(row.redirect_uri),
      };
    });
  }

  setPromptVersion(
    context: WorkspaceContext,
    mode: string,
    version: string,
  ): void {
    this.assertMembership(context, "owner");
    this.db
      .prepare(
        `INSERT INTO prompt_assignments(tenant_id, workspace_id, mode, active_version, previous_version, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT(tenant_id, workspace_id, mode) DO UPDATE SET
           previous_version = prompt_assignments.active_version,
           active_version = excluded.active_version,
           updated_at = excluded.updated_at`,
      )
      .run(context.tenantId, context.workspaceId, mode, version, nowIso());
  }

  rollbackPromptVersion(context: WorkspaceContext, mode: string): string {
    this.assertMembership(context, "owner");
    const row = this.db
      .prepare(
        "SELECT active_version, previous_version FROM prompt_assignments WHERE tenant_id = ? AND workspace_id = ? AND mode = ?",
      )
      .get(context.tenantId, context.workspaceId, mode) as
      { active_version: string; previous_version: string | null } | undefined;
    if (!row?.previous_version) throw new Error("NO_ROLLBACK_VERSION");
    this.db
      .prepare(
        `UPDATE prompt_assignments SET active_version = ?, previous_version = ?, updated_at = ?
         WHERE tenant_id = ? AND workspace_id = ? AND mode = ?`,
      )
      .run(
        row.previous_version,
        row.active_version,
        nowIso(),
        context.tenantId,
        context.workspaceId,
        mode,
      );
    return row.previous_version;
  }

  deleteUserData(context: WorkspaceContext): void {
    this.assertMembership(context, "owner");
    this.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM insights WHERE tenant_id = ? AND job_id IN (
             SELECT j.id FROM publish_jobs j
             LEFT JOIN threads_accounts a ON a.id = j.account_id
             LEFT JOIN drafts d ON d.id = j.draft_id AND d.version = j.draft_version
             WHERE j.tenant_id = ? AND (a.owner_user_id = ? OR d.owner_user_id = ?)
           )`,
        )
        .run(
          context.tenantId,
          context.tenantId,
          context.userId,
          context.userId,
        );
      this.db
        .prepare(
          `DELETE FROM publish_jobs WHERE tenant_id = ? AND (
             account_id IN (SELECT id FROM threads_accounts WHERE tenant_id = ? AND owner_user_id = ?)
             OR (draft_id, draft_version) IN (SELECT id, version FROM drafts WHERE tenant_id = ? AND owner_user_id = ?)
           )`,
        )
        .run(
          context.tenantId,
          context.tenantId,
          context.userId,
          context.tenantId,
          context.userId,
        );
      this.db
        .prepare(
          "DELETE FROM edit_diffs WHERE tenant_id = ? AND owner_user_id = ?",
        )
        .run(context.tenantId, context.userId);
      this.db
        .prepare(
          "DELETE FROM audit_logs WHERE tenant_id = ? AND actor_user_id = ?",
        )
        .run(context.tenantId, context.userId);
      this.db
        .prepare("DELETE FROM drafts WHERE tenant_id = ? AND owner_user_id = ?")
        .run(context.tenantId, context.userId);
      this.db
        .prepare(
          "DELETE FROM personas WHERE tenant_id = ? AND owner_user_id = ?",
        )
        .run(context.tenantId, context.userId);
      this.db
        .prepare(
          `DELETE FROM controls WHERE scope = 'account' AND scope_id IN (
             SELECT id FROM threads_accounts WHERE tenant_id = ? AND owner_user_id = ?
           )`,
        )
        .run(context.tenantId, context.userId);
      this.db
        .prepare(
          "DELETE FROM threads_accounts WHERE tenant_id = ? AND owner_user_id = ?",
        )
        .run(context.tenantId, context.userId);
      this.db
        .prepare("DELETE FROM oauth_states WHERE tenant_id = ? AND user_id = ?")
        .run(context.tenantId, context.userId);
      this.db
        .prepare(
          "DELETE FROM workspace_members WHERE tenant_id = ? AND user_id = ?",
        )
        .run(context.tenantId, context.userId);
      this.db
        .prepare("DELETE FROM users WHERE id = ? AND tenant_id = ?")
        .run(context.userId, context.tenantId);
    });
  }

  close(): void {
    this.db.close();
  }

  private audit(
    context: WorkspaceContext,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs(id, tenant_id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        createId("audit"),
        context.tenantId,
        context.workspaceId,
        context.userId,
        action,
        resourceType,
        resourceId,
        JSON.stringify(metadata),
        nowIso(),
      );
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function mapAccount(row: Record<string, unknown>): ThreadsAccountRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    workspaceId: String(row.workspace_id),
    ownerUserId: String(row.owner_user_id),
    threadsUserId: String(row.threads_user_id),
    username: row.username ? String(row.username) : null,
    tokenCiphertext: String(row.token_ciphertext),
    tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
    paused: Number(row.paused) === 1,
    disconnectedAt: row.disconnected_at ? String(row.disconnected_at) : null,
  };
}

function mapJob(row: Record<string, unknown>): PublishJob {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    workspaceId: String(row.workspace_id),
    accountId: String(row.account_id),
    draftId: String(row.draft_id),
    draftVersion: Number(row.draft_version),
    state: String(row.state) as PublishJobState,
    scheduledAt: String(row.scheduled_at),
    timezone: String(row.timezone),
    text: String(row.text),
    imageUrl: row.image_url ? String(row.image_url) : null,
    altText: row.alt_text ? String(row.alt_text) : null,
    mediaExpiresAt: row.media_expires_at ? String(row.media_expires_at) : null,
    contentHash: String(row.content_hash),
    idempotencyKey: String(row.idempotency_key),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseUntil: row.lease_until ? String(row.lease_until) : null,
    attempts: Number(row.attempts),
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
    remoteContainerId: row.remote_container_id
      ? String(row.remote_container_id)
      : null,
    remotePostId: row.remote_post_id ? String(row.remote_post_id) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
  };
}
