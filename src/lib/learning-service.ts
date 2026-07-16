import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import {
  mergeEvidence,
  nextMasteryScore,
  nextReviewIntervalSec,
  normalizeConceptKey,
  reviewDueAt,
  type LearningOutcome,
} from "@/lib/learning";

const outcomes = new Set<LearningOutcome>(["correct", "partial", "incorrect", "uncertain"]);

export async function recordLearningSignal(input: {
  userId: string;
  sessionId?: string;
  concept: string;
  outcome: string;
  evidence: string;
  misconception?: string;
  preferredExplanationStyle?: string;
  prompt?: string;
}) {
  const conceptKey = normalizeConceptKey(input.concept);
  const outcome = input.outcome as LearningOutcome;
  const evidence = input.evidence.trim().slice(0, 1_500);
  if (!conceptKey || !outcomes.has(outcome) || !evidence) {
    throw new Error("concept, outcome, and evidence are required.");
  }

  const signalKey = input.sessionId
    ? createSignalKey(conceptKey, outcome, evidence)
    : undefined;
  if (input.sessionId) {
    const session = await prisma.studySession.findFirst({
      where: { id: input.sessionId, userId: input.userId },
      select: { id: true },
    });
    if (!session) throw new Error("Session not found.");

    const duplicate = await findRecentDuplicate({
      sessionId: input.sessionId,
      userId: input.userId,
      conceptKey,
      outcome,
      evidence,
    });
    if (duplicate) return duplicate;
  }

  try {
    return await prisma.$transaction(async (tx) => {
    const current = await tx.conceptState.findUnique({
      where: { userId_conceptKey: { userId: input.userId, conceptKey } },
    });
    const masteryScore = nextMasteryScore(current?.masteryScore ?? 0, outcome);
    const conceptState = await tx.conceptState.upsert({
      where: { userId_conceptKey: { userId: input.userId, conceptKey } },
      update: {
        masteryScore,
        misconceptionEvidence: mergeEvidence(current?.misconceptionEvidence, evidence, input.misconception),
        preferredExplanationStyle: input.preferredExplanationStyle || current?.preferredExplanationStyle,
      },
      create: {
        userId: input.userId,
        conceptKey,
        masteryScore,
        misconceptionEvidence: mergeEvidence(null, evidence, input.misconception),
        preferredExplanationStyle: input.preferredExplanationStyle || null,
      },
    });

    const previousReview = await tx.reviewItem.findFirst({
      where: { userId: input.userId, conceptKey },
      orderBy: { updatedAt: "desc" },
    });
    const intervalSec = nextReviewIntervalSec(previousReview?.intervalSec ?? 86_400, outcome);
    const prompt = input.prompt?.trim().slice(0, 500) || `Explain ${conceptKey} in your own words, then give one example.`;
    const reviewItem = previousReview
      ? await tx.reviewItem.update({
          where: { id: previousReview.id },
          data: { prompt, dueAt: reviewDueAt(intervalSec), intervalSec, latestOutcome: outcome },
        })
      : await tx.reviewItem.create({
          data: {
            userId: input.userId,
            conceptKey,
            prompt,
            dueAt: reviewDueAt(intervalSec),
            intervalSec,
            latestOutcome: outcome,
          },
        });

    if (input.sessionId) {
      await tx.sessionTurn.create({
        data: {
          sessionId: input.sessionId,
          role: "system",
          modality: "learning_signal",
          transcript: evidence,
          signalKey,
          toolCallMetadata: JSON.stringify({ conceptKey, outcome, misconception: input.misconception }),
        },
      });
    }

      return { conceptState, reviewItem };
    });
  } catch (error) {
    if (input.sessionId && signalKey) {
      const receipt = await prisma.sessionTurn.findUnique({
        where: { sessionId_signalKey: { sessionId: input.sessionId, signalKey } },
        select: { id: true },
      });
      if (receipt) {
        const duplicate = await loadLearningState(input.userId, conceptKey);
        if (duplicate) return duplicate;
      }
    }
    throw error;
  }
}

async function findRecentDuplicate(input: {
  sessionId: string;
  userId: string;
  conceptKey: string;
  outcome: LearningOutcome;
  evidence: string;
}) {
  const turn = await prisma.sessionTurn.findFirst({
    where: {
      sessionId: input.sessionId,
      modality: "learning_signal",
      transcript: input.evidence,
      createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { toolCallMetadata: true },
  });
  if (!turn?.toolCallMetadata) return null;
  try {
    const metadata = JSON.parse(turn.toolCallMetadata) as { conceptKey?: unknown; outcome?: unknown };
    if (metadata.conceptKey !== input.conceptKey || metadata.outcome !== input.outcome) return null;
  } catch {
    return null;
  }

  return loadLearningState(input.userId, input.conceptKey);
}

async function loadLearningState(userId: string, conceptKey: string) {
  const [conceptState, reviewItem] = await Promise.all([
    prisma.conceptState.findUnique({
      where: { userId_conceptKey: { userId, conceptKey } },
    }),
    prisma.reviewItem.findFirst({
      where: { userId, conceptKey },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return conceptState && reviewItem ? { conceptState, reviewItem } : null;
}

function createSignalKey(conceptKey: string, outcome: LearningOutcome, evidence: string) {
  const fiveMinuteBucket = Math.floor(Date.now() / (5 * 60_000));
  return createHash("sha256")
    .update(`${fiveMinuteBucket}\u0000${conceptKey}\u0000${outcome}\u0000${evidence}`)
    .digest("hex");
}
