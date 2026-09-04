#!/usr/bin/env node
import "../apps/extension/node_modules/fake-indexeddb/auto/index.mjs";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { extractThreadPost } from "../packages/threads-adapter/dist/index.js";
import { ThreadFlowDatabase } from "../apps/extension/dist-types/storage/database.js";

const root = process.cwd();
const samples = [];
const dom = new JSDOM(`
  <article>
    <a href="/@writer">writer</a>
    <div dir="auto">첫 문장입니다.</div>
    <div dir="auto">둘째 문장입니다.</div>
    <a href="/@writer/post/ABC">1시간</a>
  </article>
`);
const target = dom.window.document.querySelector("article div");
for (let index = 0; index < 550; index += 1) {
  const started = performance.now();
  const captured = extractThreadPost(target, {
    pageUrl: "https://www.threads.com/@writer/post/ABC",
    capturedAt: "2026-09-04T00:00:00.000Z",
  });
  if (!captured) throw new Error("Capture benchmark failed");
  if (index >= 50) samples.push(performance.now() - started);
}
samples.sort((left, right) => left - right);
const captureP95Ms = samples[Math.floor(samples.length * 0.95)] ?? Infinity;

const databaseName = `threadflow-performance-${randomUUID()}`;
const database = new ThreadFlowDatabase(databaseName);
const now = new Date().toISOString();
const finalDraft = {
  id: "performance-draft",
  generationId: "performance-generation",
  selectedCandidateId: "performance-candidate",
  text: "복원 성능을 확인하는 승인 초안입니다.",
  score: {
    hook: 80,
    originality: 80,
    readability: 80,
    personaFit: 80,
    evidence: 80,
    cta: 80,
    policy: 80,
    total: 80,
  },
  riskFlags: [],
  approvalStatus: "APPROVED",
  promptVersion: "2.0.0",
  rubricVersion: "1.0.0",
  createdAt: now,
  approvedAt: now,
};
await database.saveDraftVersion({
  id: finalDraft.id,
  generationId: finalDraft.generationId,
  text: finalDraft.text,
  finalDraft,
  candidates: [],
  createdAt: now,
  updatedAt: now,
});
database.close();
const restoreStarted = performance.now();
const reopened = new ThreadFlowDatabase(databaseName);
const restored = await reopened.drafts.where("id").equals(finalDraft.id).last();
const editRestoreMs = performance.now() - restoreStarted;
if (restored?.text !== finalDraft.text)
  throw new Error("Draft restore benchmark failed");
await reopened.delete();

const live = JSON.parse(
  await readFile(
    resolve(root, "artifacts/smoke/live-quality-smoke.json"),
    "utf8",
  ),
);
const thresholds = {
  captureP95Ms: 25,
  firstModelDeltaMs: 30_000,
  fullGenerationMs: 180_000,
  editRestoreMs: 250,
};
const measurements = {
  captureP95Ms: Number(captureP95Ms.toFixed(3)),
  firstModelDeltaMs: live.timings?.firstDeltaMs ?? null,
  fullGenerationMs: live.timings?.totalMs ?? live.durationMs,
  editRestoreMs: Number(editRestoreMs.toFixed(3)),
};
const checks = {
  capture: measurements.captureP95Ms <= thresholds.captureP95Ms,
  firstModelDelta:
    typeof measurements.firstModelDeltaMs === "number" &&
    measurements.firstModelDeltaMs <= thresholds.firstModelDeltaMs,
  fullGeneration:
    typeof measurements.fullGenerationMs === "number" &&
    measurements.fullGenerationMs <= thresholds.fullGenerationMs,
  editRestore: measurements.editRestoreMs <= thresholds.editRestoreMs,
};
const report = {
  generatedAt: new Date().toISOString(),
  environment: "local smoke; performance budget, not a production SLA",
  measurements,
  thresholds,
  checks,
  passed: Object.values(checks).every(Boolean),
};
await mkdir(resolve(root, "artifacts/smoke"), { recursive: true });
await writeFile(
  resolve(root, "artifacts/smoke/performance-smoke.json"),
  JSON.stringify(report, null, 2),
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
