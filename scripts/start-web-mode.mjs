#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const webOrigin = process.env.THREADFLOW_WEB_ORIGINS ?? "http://127.0.0.1:4173";
const tsc = resolve(root, "node_modules/typescript/bin/tsc");
const vite = resolve(root, "apps/web/node_modules/vite/bin/vite.js");
const providerMode = process.env.THREADFLOW_CODEX_PROVIDER ?? "proxy";

process.stdout.write("ThreadFlow 웹 실행에 필요한 공유 패키지를 확인합니다.\n");
const build = spawnSync(
  process.execPath,
  [tsc, "-b", "packages/client-ui", "apps/codex-gateway"],
  { cwd: root, stdio: "inherit", env: process.env },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const gateway = spawn(process.execPath, ["apps/codex-gateway/dist/server.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    THREADFLOW_WEB_ORIGINS: webOrigin,
    THREADFLOW_DATA_ROOT: process.env.THREADFLOW_DATA_ROOT ?? root,
  },
});
const web = spawn(process.execPath, [vite], {
  cwd: resolve(root, "apps/web"),
  stdio: "inherit",
  env: process.env,
});
const children = [gateway, web];
let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}
for (const child of children) {
  child.once("exit", (code, signal) => {
    if (!stopping) stop();
    if (children.every((item) => item.exitCode !== null || item.signalCode)) {
      if (signal && signal !== "SIGTERM") process.kill(process.pid, signal);
      else process.exit(code ?? 0);
    }
  });
}

process.stdout.write(
  `\nThreadFlow 웹: ${webOrigin}\n` +
    (providerMode === "proxy"
      ? "Codex OAuth Provider Proxy가 실행 중이어야 하며 OAuth은 Proxy에서 관리합니다.\n"
      : "Direct 개발 모드입니다. 설정에서 ChatGPT 구독 OAuth 로그인을 진행하세요.\n") +
    "설정에서 .threadflow/session-secret 파일의 키 내용을 입력하세요.\n" +
    "종료: Ctrl+C\n\n",
);
