#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AppServerClient,
  CodexProviderAdapter,
  StdioAppServerTransport,
} from "../packages/codex-provider/dist/index.js";
import { QualityPipeline } from "../packages/quality-engine/dist/index.js";

const root = process.cwd();
const transport = new StdioAppServerTransport({
  cwd: root,
  ...(process.env.THREADFLOW_CODEX_BIN
    ? { codexBin: process.env.THREADFLOW_CODEX_BIN }
    : {}),
});
const adapter = new CodexProviderAdapter(new AppServerClient(transport), {
  cwd: root,
  ...(process.env.THREADFLOW_CODEX_MODEL
    ? { model: process.env.THREADFLOW_CODEX_MODEL }
    : {}),
});
const session = adapter.createGenerationProvider();
const stages = [];
const startedAt = Date.now();
const stateReachedMs = {};
let firstDeltaMs = null;

try {
  const auth = await adapter.getAuthStatus(false);
  if (!auth.authenticated) throw new Error("ChatGPT OAuth login is required");
  const result = await new QualityPipeline(session).run(
    "live-smoke",
    {
      source: {
        id: "live-source",
        text: "좋은 글을 쓰려면 첫 문장을 오래 고민하기보다 독자가 가진 질문부터 정리해 보세요.",
        author: null,
        url: null,
        capturedAt: new Date().toISOString(),
        captureMethod: "paste",
        adapterVersion: "threads-web-v1",
      },
      persona: {
        id: "live-persona",
        name: "차분한 실무 코치",
        audience: "글쓰기를 시작하는 직장인",
        voice: "짧고 구체적이며 과장하지 않는 한국어",
        goals: ["오늘 실행할 행동 하나를 제안"],
        bannedPhrases: ["무조건 성공", "100% 보장"],
        preferredLength: { min: 80, max: 450 },
        language: "ko-KR",
      },
      purpose: "독자가 오늘 한 문장을 쓰게 돕는다",
      mode: "alternate-angle",
      variationStrength: 0.9,
      candidateCount: 3,
      userEvidence: [],
      affiliateDisclosure: null,
    },
    (event) => {
      if (event.type === "state") {
        stages.push(event.state);
        stateReachedMs[event.state] ??= Date.now() - startedAt;
      }
      if (event.type === "delta" && firstDeltaMs === null)
        firstDeltaMs = Date.now() - startedAt;
    },
  );
  const durationMs = Date.now() - startedAt;
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs,
    timings: {
      firstDeltaMs,
      stateReachedMs,
      totalMs: durationMs,
    },
    auth: {
      accountType: auth.accountType,
      planType: auth.planType,
      providerVersion: auth.providerVersion,
      rateLimitsReadable: auth.rateLimits !== null,
    },
    stages,
    candidateCount: result.candidates.length,
    candidateScores: result.candidates.map((candidate) =>
      Math.round(candidate.score?.total ?? 0),
    ),
    final: {
      approvalStatus: result.finalDraft.approvalStatus,
      characterCount: result.finalDraft.text.length,
      riskCodes: result.finalDraft.riskFlags.map((flag) => flag.code),
      promptVersion: result.finalDraft.promptVersion,
      rubricVersion: result.finalDraft.rubricVersion,
    },
  };
  await mkdir(resolve(root, "artifacts/smoke"), { recursive: true });
  await writeFile(
    resolve(root, "artifacts/smoke/live-quality-smoke.json"),
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await session.close();
  await adapter.close();
}
