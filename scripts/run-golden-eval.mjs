import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deterministicFlags } from "../packages/quality-engine/dist/deterministic.js";

const root = process.cwd();
const cases = JSON.parse(
  await readFile(resolve(root, "evals/fixtures/golden-ko.json"), "utf8"),
);
const results = cases.map((item) => {
  const request = {
    source: {
      id: item.id,
      text: item.source.trim() || "(빈 자료)",
      author: null,
      url: null,
      capturedAt: new Date().toISOString(),
      captureMethod: "paste",
      adapterVersion: "threads-web-v1",
    },
    persona: {
      id: "golden",
      name: "검증",
      audience: "일반 독자",
      voice: "명확함",
      goals: [],
      bannedPhrases: item.banned,
      preferredLength: { min: 20, max: 800 },
      language: "ko-KR",
    },
    purpose: "Golden Set 검증",
    mode: item.mode,
    variationStrength: 0.8,
    candidateCount: 4,
    userEvidence: item.evidence,
    affiliateDisclosure:
      item.mode === "affiliate" && item.draft.includes("제휴")
        ? "제휴 링크 포함 가능"
        : null,
  };
  const actual = deterministicFlags(request, item.draft).map(
    (flag) => flag.code,
  );
  const missing = item.expectedFlags.filter((flag) => !actual.includes(flag));
  return {
    id: item.id,
    expected: item.expectedFlags,
    actual,
    missing,
    pass: missing.length === 0,
  };
});
const passed = results.filter((result) => result.pass).length;
const report = {
  generatedAt: new Date().toISOString(),
  promptVersion: "2.0.0",
  rubricVersion: "1.0.0",
  total: results.length,
  passed,
  failed: results.length - passed,
  fatalFlagMissRate: (results.length - passed) / results.length,
  results,
};
await mkdir(resolve(root, "artifacts/evals"), { recursive: true });
await writeFile(
  resolve(root, "artifacts/evals/golden-report.json"),
  JSON.stringify(report, null, 2),
);
await writeFile(
  resolve(root, "artifacts/evals/golden-report.md"),
  `# Golden Set 회귀 결과\n\n- 생성: ${report.generatedAt}\n- 통과: ${passed}/${results.length}\n- 치명 플래그 기대값 누락률: ${(report.fatalFlagMissRate * 100).toFixed(1)}%\n\n${results.map((result) => `- [${result.pass ? "x" : " "}] ${result.id}: expected=${result.expected.join(",") || "none"} actual=${result.actual.join(",") || "none"}`).join("\n")}\n`,
);
process.stdout.write(
  JSON.stringify(
    { total: results.length, passed, failed: results.length - passed },
    null,
    2,
  ) + "\n",
);
if (passed !== results.length) process.exitCode = 1;
