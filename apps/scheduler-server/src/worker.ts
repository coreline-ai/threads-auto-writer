import type { ThreadFlowRepository } from "@threadflow-os/database";
import type { AesGcmVault } from "@threadflow-os/shared";
import {
  ThreadsApiError,
  type ThreadsApiClient,
} from "@threadflow-os/threads-client";

export class PublishWorker {
  #timer: NodeJS.Timeout | null = null;
  #tickRunning = false;

  constructor(
    private readonly options: {
      repository: ThreadFlowRepository;
      client: ThreadsApiClient;
      vault: AesGcmVault;
      workerId: string;
      pollMs?: number;
      maxAttempts?: number;
      mediaPollMs?: number;
      mediaPollAttempts?: number;
      sleep?: (milliseconds: number) => Promise<void>;
      mediaLifecycle?: {
        revoke(url: string): Promise<void>;
      };
    },
  ) {}

  start(): void {
    if (this.#timer) return;
    this.options.repository.recoverExpiredPublishing();
    this.#timer = setInterval(
      () => void this.tick(),
      this.options.pollMs ?? 1_000,
    );
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async runOnce(now = new Date()): Promise<boolean> {
    const job = this.options.repository.leaseNextDueJob(
      this.options.workerId,
      now,
    );
    if (!job) return false;
    const account = this.options.repository.getThreadsAccountInternal(
      job.accountId,
    );
    if (!account || account.paused || account.disconnectedAt) {
      this.options.repository.markDeadLetter(
        job.id,
        this.options.workerId,
        "ACCOUNT_UNAVAILABLE",
      );
      return true;
    }
    const associatedData = `${account.tenantId}:${account.id}`;
    let terminal = false;
    try {
      let accessToken = this.options.vault.decrypt(
        account.tokenCiphertext,
        associatedData,
      );
      if (
        job.imageUrl &&
        (!job.mediaExpiresAt ||
          Date.parse(job.mediaExpiresAt) - now.getTime() < 60_000)
      ) {
        throw new ThreadsApiError(
          "Managed media URL expired before the publish window",
          400,
          "MEDIA_URL_EXPIRED",
          false,
        );
      }
      if (
        account.tokenExpiresAt &&
        Date.parse(account.tokenExpiresAt) - now.getTime() <
          7 * 24 * 60 * 60_000
      ) {
        const refreshed = await this.options.client.refreshToken(accessToken);
        if (
          typeof refreshed.access_token !== "string" ||
          !refreshed.access_token ||
          typeof refreshed.expires_in !== "number" ||
          refreshed.expires_in <= 0
        ) {
          throw new ThreadsApiError(
            "Threads returned an invalid refreshed token",
            502,
            "INVALID_REFRESH_TOKEN",
            false,
          );
        }
        accessToken = refreshed.access_token;
        const expiresAt = new Date(
          now.getTime() + refreshed.expires_in * 1_000,
        ).toISOString();
        this.options.repository.updateThreadsTokenInternal(
          account.id,
          this.options.vault.encrypt(accessToken, associatedData),
          expiresAt,
        );
      }
      const container = await this.options.client.createContainer({
        userId: account.threadsUserId,
        accessToken,
        text: job.text,
        imageUrl: job.imageUrl,
        altText: job.altText,
      });
      this.options.repository.markPublishing(
        job.id,
        this.options.workerId,
        container.id,
      );
      if (job.imageUrl) {
        await this.waitForMediaContainer(container.id, accessToken);
      }
      const published = await this.options.client.publish({
        userId: account.threadsUserId,
        accessToken,
        containerId: container.id,
      });
      this.options.repository.markPublished(
        job.id,
        this.options.workerId,
        published.id,
      );
      terminal = true;
      return true;
    } catch (error) {
      const apiError = normalizeWorkerError(error);
      if (apiError.authFailure) {
        this.options.repository.setPaused("account", account.id, true);
      }
      if (apiError.outcomeUnknown || !apiError.retryable) {
        this.options.repository.markDeadLetter(
          job.id,
          this.options.workerId,
          apiError.code,
        );
        terminal = true;
      } else {
        const delayMs = backoffMs(job.attempts);
        this.options.repository.markRetry(
          job.id,
          this.options.workerId,
          apiError.code,
          new Date(now.getTime() + delayMs),
          this.options.maxAttempts ?? 5,
        );
      }
      return true;
    } finally {
      if (terminal && job.imageUrl && this.options.mediaLifecycle) {
        await this.options.mediaLifecycle.revoke(job.imageUrl).catch(() => {});
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.#tickRunning) return;
    this.#tickRunning = true;
    try {
      await this.runOnce();
    } finally {
      this.#tickRunning = false;
    }
  }

  private async waitForMediaContainer(
    containerId: string,
    accessToken: string,
  ): Promise<void> {
    const sleep = this.options.sleep ?? defaultSleep;
    const attempts = this.options.mediaPollAttempts ?? 7;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await this.options.client.getContainerStatus(
        containerId,
        accessToken,
      );
      const status = result.status?.toUpperCase();
      if (status === "FINISHED" || status === "PUBLISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new ThreadsApiError(
          result.error_message ?? "Threads media container failed",
          400,
          `CONTAINER_${status}`,
          false,
        );
      }
      if (attempt + 1 < attempts) {
        await sleep(this.options.mediaPollMs ?? 5_000);
      }
    }
    throw new ThreadsApiError(
      "Threads media container was not ready before the worker deadline",
      503,
      "CONTAINER_PROCESSING_TIMEOUT",
      true,
    );
  }
}

export function backoffMs(attempt: number): number {
  const exponential = Math.min(
    60 * 60_000,
    2 ** Math.max(0, attempt - 1) * 30_000,
  );
  return (
    exponential +
    Math.floor(Math.random() * Math.min(10_000, exponential * 0.2))
  );
}

function normalizeWorkerError(error: unknown): {
  code: string;
  retryable: boolean;
  outcomeUnknown: boolean;
  authFailure: boolean;
} {
  if (error instanceof ThreadsApiError) {
    return {
      code: error.code,
      retryable: error.retryable,
      outcomeUnknown: error.outcomeUnknown,
      authFailure:
        error.status === 401 ||
        error.status === 403 ||
        error.code === "190" ||
        /TOKEN|OAUTH/i.test(error.code),
    };
  }
  return {
    code: "INTERNAL",
    retryable: false,
    outcomeUnknown: false,
    authFailure: false,
  };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
