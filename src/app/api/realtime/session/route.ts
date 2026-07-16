import OpenAI from "openai";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { parsePersistedLectureDeck } from "@/lib/persisted-deck";
import {
  buildRealtimeTutorInstructions,
  OPENAI_REALTIME_MODEL,
} from "@/lib/realtime-tutor-context";

export const runtime = "nodejs";

type RealtimeSessionRequest = {
  sessionId?: string;
  currentSlideIndex?: number;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Realtime tutoring is not configured.",
        code: "OPENAI_API_KEY_MISSING",
      },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as RealtimeSessionRequest;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "A study session is required." }, { status: 400 });
  }

  const { id: userId } = await ensureLocalUser();
  const studySession = await prisma.studySession.findFirst({
    where: { id: sessionId, userId },
    include: { deck: true },
  });
  if (!studySession) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  let deck;
  try {
    deck = parsePersistedLectureDeck(studySession.deck);
  } catch {
    return NextResponse.json({ error: "The session deck is invalid." }, { status: 500 });
  }
  if (!deck.slides.length) {
    return NextResponse.json({ error: "The session has no slides." }, { status: 400 });
  }

  const requestedSlideIndex = Number.isSafeInteger(body.currentSlideIndex)
    ? body.currentSlideIndex as number
    : studySession.currentSlide;
  if (requestedSlideIndex < 0 || requestedSlideIndex >= deck.slides.length) {
    return NextResponse.json({ error: "Current slide is outside the deck." }, { status: 400 });
  }
  const learnerContext = await loadLearnerContext(userId);
  const model = process.env.OPENAI_REALTIME_MODEL?.trim() || OPENAI_REALTIME_MODEL;
  const instructions = buildRealtimeTutorInstructions({
    deck,
    currentSlideIndex: requestedSlideIndex,
    teachingFormat: studySession.teachingFormat,
    customInstructions: studySession.customInstructions ?? "",
    learnerContext,
  });

  try {
    const client = new OpenAI({ apiKey });
    const secret = await client.realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: "auto",
              interrupt_response: true,
              create_response: true,
            },
            transcription: { model: "gpt-4o-mini-transcribe" },
          },
          output: { voice: "marin" },
        },
        max_output_tokens: 1200,
      },
    });

    return NextResponse.json({
      value: secret.value,
      expiresAt: secret.expires_at,
      sessionId: secret.session.id,
      instructions,
      learnerContext,
      model,
    });
  } catch (error) {
    console.error("[studydeck] realtime client secret failed", error);
    return NextResponse.json(
      { error: "Could not start realtime tutoring." },
      { status: 502 },
    );
  }
}

async function loadLearnerContext(userId: string) {
  const reviewItems = await prisma.reviewItem.findMany({
    where: { userId },
    orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
    take: 6,
    select: { conceptKey: true, latestOutcome: true, dueAt: true },
  });
  return reviewItems
    .map((item) => `${item.conceptKey} (${item.latestOutcome ?? "new"}, due ${item.dueAt.toISOString()})`)
    .join("; ");
}
