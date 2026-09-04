import type { WorkspaceContext } from "@threadflow-os/contracts";
import type { ThreadFlowRepository } from "@threadflow-os/database";
import type { AesGcmVault } from "@threadflow-os/shared";
import type { ThreadsApiClient } from "@threadflow-os/threads-client";

export const DEFAULT_INSIGHT_METRICS = [
  "views",
  "likes",
  "replies",
  "reposts",
  "quotes",
  "shares",
] as const;

export class InsightsCollector {
  constructor(
    private readonly options: {
      repository: ThreadFlowRepository;
      client: ThreadsApiClient;
      vault: AesGcmVault;
    },
  ) {}

  async collect(
    context: WorkspaceContext,
    jobId: string,
  ): Promise<{ measuredAt: string; metrics: Record<string, number> }> {
    const job = this.options.repository.getJob(context, jobId);
    if (!job) throw new Error("NOT_FOUND: publish job");
    if (job.state !== "PUBLISHED" || !job.remotePostId)
      throw new Error("JOB_NOT_PUBLISHED");
    const account = this.options.repository.getThreadsAccount(
      context,
      job.accountId,
    );
    if (!account || account.disconnectedAt)
      throw new Error("ACCOUNT_UNAVAILABLE");
    const accessToken = this.options.vault.decrypt(
      account.tokenCiphertext,
      `${account.tenantId}:${account.id}`,
    );
    const payload = await this.options.client.getInsights(
      job.remotePostId,
      accessToken,
      [...DEFAULT_INSIGHT_METRICS],
    );
    const metrics = parseInsights(payload);
    const measuredAt = new Date().toISOString();
    this.options.repository.saveInsights({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      accountId: account.id,
      jobId,
      metrics,
      measuredAt,
    });
    return { measuredAt, metrics };
  }
}

export function parseInsights(payload: unknown): Record<string, number> {
  if (!payload || typeof payload !== "object") return {};
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return {};
  const metrics: Record<string, number> = {};
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as {
      name?: unknown;
      values?: Array<{ value?: unknown }>;
    };
    if (typeof candidate.name !== "string") continue;
    const value = candidate.values?.at(-1)?.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[candidate.name] = value;
    }
  }
  return metrics;
}
