import { prisma } from "@/lib/db";

export async function appendSessionEvent(input: {
  sessionId: string;
  clientEventId?: string;
  kind: string;
  role?: string;
  modality?: string;
  transcript?: string;
  slideIndex?: number | null;
  relativeTimeMs?: number | null;
  startedAtMs?: number | null;
  durationMs?: number | null;
  payload?: unknown;
}) {
  const payload = safeJson(input.payload ?? {}, 100_000);
  return prisma.$transaction(async (tx) => {
    if (input.clientEventId) {
      const existing = await tx.sessionEvent.findUnique({
        where: {
          sessionId_clientEventId: {
            sessionId: input.sessionId,
            clientEventId: input.clientEventId,
          },
        },
      });
      if (existing) return existing;
    }
    const claimed = await tx.studySession.update({
      where: { id: input.sessionId },
      data: { lastEventSeq: { increment: 1 } },
      select: { lastEventSeq: true },
    });
    const event = await tx.sessionEvent.create({
      data: {
        sessionId: input.sessionId,
        clientEventId: input.clientEventId,
        sequence: claimed.lastEventSeq,
        kind: input.kind.slice(0, 80),
        slideIndex: safeInteger(input.slideIndex),
        relativeTimeMs: safeInteger(input.relativeTimeMs),
        payload,
      },
    });
    const transcript = input.transcript?.trim().slice(0, 20_000);
    if (transcript) {
      await tx.sessionTurn.create({
        data: {
          sessionId: input.sessionId,
          role: input.role?.slice(0, 30) || "system",
          modality: input.modality?.slice(0, 30) || "event",
          transcript,
          startedAtMs: safeInteger(input.startedAtMs),
          durationMs: safeInteger(input.durationMs),
          toolCallMetadata: payload,
        },
      });
    }
    return event;
  });
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function safeJson(value: unknown, max: number) {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "{}";
  }
}
