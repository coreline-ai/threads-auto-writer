#!/usr/bin/env node
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const releaseRoot = resolve(root, "release");
const target = resolve(releaseRoot, "threadflow-companion-macos");
await mkdir(releaseRoot, { recursive: true });
await rm(target, { recursive: true, force: true });
const deploy = spawnSync(
  "pnpm",
  ["--filter", "@threadflow-os/codex-gateway", "--prod", "deploy", target],
  { cwd: root, stdio: "inherit" },
);
if (deploy.status !== 0) process.exit(deploy.status ?? 1);
await Promise.all(
  [
    resolve(target, "dist"),
    ...[
      "contracts",
      "shared",
      "prompt-kit",
      "quality-engine",
      "codex-provider",
    ].map((name) =>
      resolve(target, "node_modules", "@threadflow-os", name, "dist"),
    ),
  ].map(pruneBuildMetadata),
);
const launcher = `#!/bin/zsh\nset -euo pipefail\ncd "$(dirname "$0")"\n: \${THREADFLOW_EXTENSION_ORIGINS:?Set THREADFLOW_EXTENSION_ORIGINS to chrome-extension://<installed-id>}\nexport THREADFLOW_DATA_ROOT="\${THREADFLOW_DATA_ROOT:-$PWD}"\nexec node dist/server.js\n`;
await writeFile(resolve(target, "threadflow-companion"), launcher, {
  mode: 0o755,
});
await chmod(resolve(target, "threadflow-companion"), 0o755);
await writeFile(
  resolve(target, "README.txt"),
  "ThreadFlow OS Companion\n\n1. Install Node.js 22+ and Codex CLI.\n2. Run codex login and choose ChatGPT.\n3. Set THREADFLOW_EXTENSION_ORIGINS.\n4. Run ./threadflow-companion.\n5. Open .threadflow/session-secret and paste the file contents (not the path) into the Side Panel Companion key field.\n\nChrome Web Store submission and Apple notarization are not required for local developer-mode use.\n",
);
const archive = resolve(releaseRoot, "threadflow-companion-macos.tar.gz");
const tar = spawnSync(
  "tar",
  ["-czf", archive, "-C", releaseRoot, "threadflow-companion-macos"],
  { stdio: "inherit" },
);
if (tar.status !== 0) process.exit(tar.status ?? 1);
process.stdout.write(`${archive}\n`);

async function pruneBuildMetadata(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return pruneBuildMetadata(path);
      if (
        entry.name === ".tsbuildinfo" ||
        /\.test\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(entry.name)
      ) {
        await rm(path, { force: true });
      }
    }),
  );
}
