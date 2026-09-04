import { resolve } from "node:path";
import { ThreadFlowRepository } from "@threadflow-os/database";
import { AesGcmVault, createId } from "@threadflow-os/shared";
import { ThreadsApiClient } from "@threadflow-os/threads-client";
import { buildScheduler } from "./app.js";
import { parseSchedulerAccessKeys, validateMetaRedirectUri } from "./config.js";
import { PublishWorker } from "./worker.js";

const required = [
  "SCHEDULER_MASTER_KEY",
  "META_APP_ID",
  "META_APP_SECRET",
  "META_REDIRECT_URI",
  "SCHEDULER_ACCESS_KEYS_JSON",
] as const;
for (const name of required)
  if (!process.env[name]) throw new Error(`${name} is required`);

const repository = new ThreadFlowRepository(
  resolve(process.env.SCHEDULER_DB_PATH ?? "data/threadflow.sqlite"),
);
const vault = new AesGcmVault(process.env.SCHEDULER_MASTER_KEY!);
const metaRedirectUri = validateMetaRedirectUri(process.env.META_REDIRECT_URI!);
const threadsClient = new ThreadsApiClient({
  appId: process.env.META_APP_ID!,
  appSecret: process.env.META_APP_SECRET!,
  redirectUri: metaRedirectUri,
  graphBaseUrl: `https://graph.threads.net/${process.env.META_GRAPH_VERSION ?? "v1.0"}`,
  usePkce: process.env.META_USE_PKCE === "true",
});
const accessKeys = parseSchedulerAccessKeys(
  process.env.SCHEDULER_ACCESS_KEYS_JSON!,
);
for (const context of accessKeys.values()) {
  repository.bootstrapWorkspace({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: context.role,
    name: context.workspaceId,
    email: `${context.userId}@local.threadflow.invalid`,
  });
}
const app = await buildScheduler({
  repository,
  threadsClient,
  vault,
  accessKeys,
  oauthRedirectUri: metaRedirectUri,
});
const worker = new PublishWorker({
  repository,
  client: threadsClient,
  vault,
  workerId: createId("worker"),
});
worker.start();
const host = process.env.SCHEDULER_HOST ?? "127.0.0.1";
const port = Number(process.env.SCHEDULER_PORT ?? 8788);
await app.listen({ host, port });
process.stdout.write(
  `ThreadFlow Scheduler listening on http://${host}:${port}\n`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    worker.stop();
    await app.close();
    repository.close();
    process.exit(0);
  });
}
