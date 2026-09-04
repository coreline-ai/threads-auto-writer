#!/usr/bin/env node
import { spawn } from "node:child_process";

const extensionId = process.argv.slice(2).find((value) => value !== "--");
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  process.stderr.write(
    "사용법: pnpm start:developer -- <chrome-extension-id>\n" +
      "Chrome 개발자 모드에서 압축 해제 확장을 로드한 뒤 표시되는 32자 ID를 입력하세요.\n",
  );
  process.exit(1);
}

const root = process.cwd();
const child = spawn(process.execPath, ["apps/codex-gateway/dist/server.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    THREADFLOW_EXTENSION_ORIGINS: `chrome-extension://${extensionId}`,
    THREADFLOW_DATA_ROOT: process.env.THREADFLOW_DATA_ROOT ?? root,
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
