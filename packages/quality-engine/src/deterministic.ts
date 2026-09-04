import type {
  DraftCandidate,
  GenerationRequest,
  Persona,
  QualityScore,
  RiskFlag,
} from "@threadflow-os/contracts";
import { countThreadsTextUnits } from "@threadflow-os/contracts";

export type DeterministicPolicy = {
  sourceSimilarityBlocking: number;
  candidateSimilarityWarning: number;
  affiliateDisclosureTerms: string[];
};

export const defaultPolicy: DeterministicPolicy = {
  sourceSimilarityBlocking: 0.42,
  candidateSimilarityWarning: 0.72,
  affiliateDisclosureTerms: ["제휴", "광고", "수수료", "파트너스 활동"],
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function characterNgrams(value: string, size = 4): Set<string> {
  const normalized = normalizeText(value).replace(/\s/g, "");
  const grams = new Set<string>();
  if (normalized.length < size) {
    if (normalized) grams.add(normalized);
    return grams;
  }
  for (let index = 0; index <= normalized.length - size; index += 1) {
    grams.add(normalized.slice(index, index + size));
  }
  return grams;
}

export function jaccardSimilarity(
  left: string,
  right: string,
  size = 4,
): number {
  const a = characterNgrams(left, size);
  const b = characterNgrams(right, size);
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function candidateDiversity(candidates: DraftCandidate[]): number {
  if (candidates.length < 2) return 1;
  const similarities: number[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      similarities.push(
        jaccardSimilarity(candidates[i]!.text, candidates[j]!.text),
      );
    }
  }
  return 1 - Math.max(...similarities);
}

const CLAIM_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "숫자", pattern: /\b\d[\d,.]*\b/g },
  { label: "퍼센트", pattern: /\b\d+(?:\.\d+)?\s*%/g },
  {
    label: "가격",
    pattern: /(?:₩|\$|원|만원|억원)\s*\d|\d[\d,.]*\s*(?:원|만원|억원)/g,
  },
  {
    label: "날짜",
    pattern: /\b(?:20\d{2}|\d{1,2})[./-](?:\d{1,2})(?:[./-]\d{1,2})?\b/g,
  },
  { label: "수익", pattern: /(?:수익|매출|돈을 벌|연봉|월급|부수입|ROI)/gi },
  {
    label: "효능",
    pattern: /(?:완치|치료|효과가 있다|개선된다|보장한다|무조건)/gi,
  },
];

export function extractClaimSignals(text: string): string[] {
  const signals = new Set<string>();
  for (const { label, pattern } of CLAIM_PATTERNS) {
    for (const match of text.matchAll(
      new RegExp(pattern.source, pattern.flags),
    )) {
      signals.add(`${label}:${match[0]}`);
    }
  }
  return [...signals];
}

function evidenceSupports(signal: string, evidence: string[]): boolean {
  const value = signal.split(":").slice(1).join(":").toLocaleLowerCase("ko-KR");
  return evidence.some((item) =>
    item.toLocaleLowerCase("ko-KR").includes(value),
  );
}

export function deterministicFlags(
  request: GenerationRequest,
  text: string,
  peers: DraftCandidate[] = [],
  policy: DeterministicPolicy = defaultPolicy,
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const threadsUnits = countThreadsTextUnits(text);
  if (threadsUnits > 500) {
    flags.push({
      code: "THREADS_LIMIT_EXCEEDED",
      severity: "blocking",
      message: "Threads 텍스트 한도 500단위를 초과했습니다.",
      evidence: `${threadsUnits}/500 units`,
      requiresReview: true,
    });
  }
  const sourceSimilarity = jaccardSimilarity(request.source.text, text);
  if (sourceSimilarity >= policy.sourceSimilarityBlocking) {
    flags.push({
      code: "SOURCE_SIMILARITY",
      severity: "blocking",
      message: "원문과의 문자 패턴 유사도가 허용 기준을 넘었습니다.",
      evidence: `4-gram Jaccard=${sourceSimilarity.toFixed(3)}`,
      requiresReview: true,
    });
  }

  const peerSimilarity = peers.reduce(
    (max, peer) => Math.max(max, jaccardSimilarity(peer.text, text)),
    0,
  );
  if (peerSimilarity >= policy.candidateSimilarityWarning) {
    flags.push({
      code: "CANDIDATE_DUPLICATION",
      severity: "warning",
      message: "다른 후보와 전개가 지나치게 비슷합니다.",
      evidence: `max similarity=${peerSimilarity.toFixed(3)}`,
      requiresReview: false,
    });
  }

  const unsupported = extractClaimSignals(text).filter(
    (signal) => !evidenceSupports(signal, request.userEvidence),
  );
  if (unsupported.length) {
    flags.push({
      code: "UNSUPPORTED_CLAIM",
      severity: "blocking",
      message:
        "사용자가 제공하지 않은 숫자·가격·날짜·수익·효능 표현이 있습니다.",
      evidence: unsupported.slice(0, 8).join(", "),
      requiresReview: true,
    });
  }

  const banned = request.persona.bannedPhrases.filter((phrase) =>
    normalizeText(text).includes(normalizeText(phrase)),
  );
  if (banned.length) {
    flags.push({
      code: "BANNED_PHRASE",
      severity: "blocking",
      message: "Persona 금지 표현이 포함되었습니다.",
      evidence: banned.join(", "),
      requiresReview: true,
    });
  }

  if (
    text.length < request.persona.preferredLength.min ||
    text.length > request.persona.preferredLength.max
  ) {
    flags.push({
      code: "LENGTH_OUT_OF_RANGE",
      severity: "warning",
      message: "Persona의 권장 글자 수 범위를 벗어났습니다.",
      evidence: `${text.length}자 / ${request.persona.preferredLength.min}~${request.persona.preferredLength.max}자`,
      requiresReview: false,
    });
  }

  if (
    request.mode === "affiliate" &&
    !containsAffiliateDisclosure(request, text, policy)
  ) {
    flags.push({
      code: "AFFILIATE_DISCLOSURE_MISSING",
      severity: "blocking",
      message: "쇼핑·제휴 글에 필요한 이해관계 고지가 없습니다.",
      evidence: null,
      requiresReview: true,
    });
  }
  return flags;
}

function containsAffiliateDisclosure(
  request: GenerationRequest,
  text: string,
  policy: DeterministicPolicy,
): boolean {
  const normalizedText = normalizeText(text);
  const required = request.affiliateDisclosure?.trim();
  if (required) return normalizedText.includes(normalizeText(required));
  return policy.affiliateDisclosureTerms.some((term) =>
    normalizedText.includes(normalizeText(term)),
  );
}

export function mergeScores(
  model: QualityScore,
  flags: RiskFlag[],
): QualityScore {
  const originalityPenalty = flags.some(
    (flag) => flag.code === "SOURCE_SIMILARITY",
  )
    ? 55
    : 0;
  const evidencePenalty = flags.some(
    (flag) => flag.code === "UNSUPPORTED_CLAIM",
  )
    ? 55
    : 0;
  const policyPenalty =
    flags.filter((flag) => flag.severity === "blocking").length * 25;
  const next = {
    ...model,
    originality: Math.max(0, model.originality - originalityPenalty),
    evidence: Math.max(0, model.evidence - evidencePenalty),
    policy: Math.max(0, model.policy - policyPenalty),
  };
  const weights: Record<Exclude<keyof QualityScore, "total">, number> = {
    hook: 0.15,
    originality: 0.2,
    readability: 0.15,
    personaFit: 0.15,
    evidence: 0.15,
    cta: 0.1,
    policy: 0.1,
  };
  next.total = Math.round(
    Object.entries(weights).reduce(
      (sum, [key, weight]) => sum + next[key as keyof typeof weights] * weight,
      0,
    ),
  );
  return next;
}

export function findRiskSentences(text: string, flags: RiskFlag[]): string[] {
  const evidence = flags.flatMap((flag) =>
    flag.evidence ? flag.evidence.split(", ") : [],
  );
  return text
    .split(/(?<=[.!?。]|\n)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) =>
      evidence.some((item) => sentence.includes(item.split(":").at(-1) ?? "")),
    );
}

export function personaLength(persona: Persona): number {
  return Math.round(
    (persona.preferredLength.min + persona.preferredLength.max) / 2,
  );
}
