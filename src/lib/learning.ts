export type LearningOutcome = "correct" | "partial" | "incorrect" | "uncertain";

export type LearningSignal = {
  concept: string;
  outcome: LearningOutcome;
  evidence: string;
  misconception?: string;
  preferredExplanationStyle?: string;
};

const OUTCOME_DELTA: Record<LearningOutcome, number> = {
  correct: 0.14,
  partial: 0.05,
  incorrect: -0.12,
  uncertain: -0.04,
};

export function normalizeConceptKey(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
}

export function nextMasteryScore(current: number, outcome: LearningOutcome) {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  return Math.max(0, Math.min(1, safeCurrent + OUTCOME_DELTA[outcome]));
}

export function nextReviewIntervalSec(currentIntervalSec: number, outcome: LearningOutcome) {
  const safeCurrent = Number.isFinite(currentIntervalSec) && currentIntervalSec > 0
    ? currentIntervalSec
    : 86_400;
  if (outcome === "incorrect") return 600;
  if (outcome === "uncertain") return Math.min(Math.max(1_800, Math.round(safeCurrent * 0.6)), 7 * 86_400);
  if (outcome === "partial") return Math.min(Math.max(3_600, Math.round(safeCurrent * 1.5)), 30 * 86_400);
  return Math.min(Math.max(86_400, Math.round(safeCurrent * 2.4)), 90 * 86_400);
}

export function reviewDueAt(intervalSec: number, now = new Date()) {
  return new Date(now.getTime() + intervalSec * 1_000);
}

export function mergeEvidence(existing: string | null | undefined, evidence: string, misconception?: string) {
  const entries = parseEvidence(existing);
  const next = {
    evidence: evidence.trim().slice(0, 1_500),
    misconception: misconception?.trim().slice(0, 1_500) || undefined,
    at: new Date().toISOString(),
  };
  entries.push(next);
  return JSON.stringify(entries.slice(-8));
}

function parseEvidence(value: string | null | undefined) {
  if (!value) return [] as Array<{ evidence: string; misconception?: string; at: string }>;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is { evidence: string; misconception?: string; at: string } => (
      Boolean(entry) && typeof entry === "object" && typeof (entry as { evidence?: unknown }).evidence === "string"
    ));
  } catch {
    return [];
  }
}
