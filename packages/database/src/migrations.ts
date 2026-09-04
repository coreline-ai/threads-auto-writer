export const migrations = [
  `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
    created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, workspace_id, user_id),
    FOREIGN KEY(workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY(user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS threads_accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    threads_user_id TEXT NOT NULL,
    username TEXT,
    token_ciphertext TEXT NOT NULL,
    token_expires_at TEXT,
    paused INTEGER NOT NULL DEFAULT 0,
    disconnected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, workspace_id, threads_user_id),
    FOREIGN KEY(workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY(owner_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY(owner_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    final_draft_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    parent_version INTEGER,
    created_at TEXT NOT NULL,
    PRIMARY KEY(id, version),
    FOREIGN KEY(workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY(owner_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS edit_diffs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    before_hash TEXT NOT NULL,
    after_hash TEXT NOT NULL,
    diff_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prompt_assignments (
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    active_version TEXT NOT NULL,
    previous_version TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, workspace_id, mode),
    FOREIGN KEY(workspace_id, tenant_id) REFERENCES workspaces(id, tenant_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    verifier_ciphertext TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publish_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL,
    draft_version INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('SCHEDULED', 'LEASED', 'PUBLISHING', 'PUBLISHED', 'RETRY_WAIT', 'DEAD_LETTER', 'CANCELED')),
    scheduled_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    text TEXT NOT NULL,
    image_url TEXT,
    alt_text TEXT,
    content_hash TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    lease_owner TEXT,
    lease_until TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    remote_container_id TEXT,
    remote_post_id TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(draft_id, draft_version) REFERENCES drafts(id, version) ON DELETE RESTRICT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_active_content
    ON publish_jobs(tenant_id, account_id, content_hash)
    WHERE state IN ('SCHEDULED', 'LEASED', 'PUBLISHING', 'RETRY_WAIT');
  CREATE INDEX IF NOT EXISTS publish_jobs_due
    ON publish_jobs(state, next_attempt_at, scheduled_at, lease_until);

  CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    measured_at TEXT NOT NULL,
    UNIQUE(tenant_id, job_id, metric, measured_at)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS controls (
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    paused INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(scope, scope_id)
  );
  `,
  `ALTER TABLE publish_jobs ADD COLUMN media_expires_at TEXT;`,
] as const;
