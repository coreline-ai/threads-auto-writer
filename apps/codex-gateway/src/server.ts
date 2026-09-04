import { resolve } from "node:path";
import {
  AppServerClient,
  CodexProviderAdapter,
  StdioAppServerTransport,
} from "@threadflow-os/codex-provider";
import { loadOrCreateSecret } from "@threadflow-os/shared";
import { buildGateway } from "./app.js";

const root = resolve(process.env.THREADFLOW_DATA_ROOT ?? process.cwd());
const host = process.env.THREADFLOW_HOST ?? "127.0.0.1";
const port = Number(process.env.THREADFLOW_PORT ?? 8787);
const allowedOrigins = (process.env.THREADFLOW_EXTENSION_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (host !== "127.0.0.1" && host !== "::1")
  throw new Error("ThreadFlow Gateway must bind to loopback only");
if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error("THREADFLOW_PORT must be an integer between 1 and 65535");
if (!allowedOrigins.length)
  throw new Error(
    "THREADFLOW_EXTENSION_ORIGINS must contain the installed extension origin",
  );
if (
  allowedOrigins.some(
    (origin) => !/^chrome-extension:\/\/[a-p]{32}$/.test(origin),
  )
)
  throw new Error(
    "THREADFLOW_EXTENSION_ORIGINS must contain only Chrome extension origins",
  );

const secretPath = resolve(
  root,
  process.env.THREADFLOW_SESSION_SECRET_FILE ?? ".threadflow/session-secret",
);
const bootstrapSecret = await loadOrCreateSecret(secretPath);
const transport = new StdioAppServerTransport({
  cwd: root,
  ...(process.env.THREADFLOW_CODEX_BIN
    ? { codexBin: process.env.THREADFLOW_CODEX_BIN }
    : {}),
});
const client = new AppServerClient(transport);
const provider = new CodexProviderAdapter(client, {
  cwd: root,
  ...(process.env.THREADFLOW_CODEX_MODEL
    ? { model: process.env.THREADFLOW_CODEX_MODEL }
    : {}),
});
const app = await buildGateway({
  port,
  allowedOrigins,
  bootstrapSecret,
  provider,
});

try {
  await app.listen({ host, port });
  process.stdout.write(
    `ThreadFlow Codex Gateway listening on http://${host}:${port}\n`,
  );
  process.stdout.write(`Companion key file: ${secretPath}\n`);
  process.stdout.write(
    "Paste the file contents, not the file path, into the Side Panel settings.\n",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    process.stderr.write(
      `Port ${port} is already in use. The packaged extension expects port 8787; stop the conflicting process and retry.\n`,
    );
  }
  await app.close();
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
