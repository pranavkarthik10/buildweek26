import { NextResponse } from "next/server";

import type { LectureSlide, TeachingFormat } from "@/lib/aiprof-types";
import { getErrorMessage, getGeneralModel } from "@/lib/gemini";
import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { appendSessionEvent } from "@/lib/session-events";
import { parsePersistedLectureDeck } from "@/lib/persisted-deck";
import { answerTutorQuestion, answerTutorQuestionWithTools } from "@/lib/whiteboard-agent";
import type { BoardDiff, SemanticShape, TutorBoardContext } from "@/lib/tutor-tools";

type QuestionPayload = {
  deckTitle?: string;
  courseName?: string;
  summary?: string;
  studyStrategy?: string;
  teachingFormat?: TeachingFormat;
  customInstructions?: string;
  sessionId?: string;
  currentSlideIndex?: number;
  visualIntent?: boolean;
  boardContext?: unknown;
  currentSlide?: LectureSlide;
  currentStop?: LectureSlide;
  question?: string;
};

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as QuestionPayload;

    if (body.sessionId?.trim()) {
      const { id: userId } = await ensureLocalUser();
      const session = await prisma.studySession.findFirst({
        where: { id: body.sessionId.trim(), userId },
        include: { deck: true },
      });
      if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

      const deck = parsePersistedLectureDeck(session.deck);
      const currentSlideIndex = Math.min(Math.max(session.currentSlide, 0), Math.max(deck.slides.length - 1, 0));
      const currentSlide = deck.slides[currentSlideIndex];
      if (!body.question?.trim()) return NextResponse.json({ error: "Question is required." }, { status: 400 });
      if (!currentSlide) return NextResponse.json({ error: "The session has no current slide." }, { status: 400 });

      const tutor = await answerTutorQuestionWithTools({
        userId,
        question: body.question?.trim() ?? "",
        context: {
          sessionId: session.id,
          learnerQuestion: body.question.trim(),
          deck,
          currentSlideIndex,
          currentSlide,
          teachingFormat: session.teachingFormat,
          customInstructions: session.customInstructions ?? "",
          learnerContext: await loadLearnerContext(userId),
          board: normalizeBoardContext(body.boardContext, session.boardVersion),
          visualIntent: body.visualIntent === true,
        },
      });

      await persistToolTrace(session.id, tutor);
      return NextResponse.json({
        ...tutor,
        answer: tutor.tutor.spokenAnswer,
        debug: {
          route: "/api/lecture/question",
          model: getGeneralModel(),
          durationMs: Date.now() - startedAt,
          slideNumber: currentSlide.slideNumber,
          slideTitle: currentSlide.title,
          sessionId: session.id,
          ok: true,
        },
      });
    }

    const currentSlide = body.currentSlide ?? body.currentStop;

    if (!body.question?.trim() || !currentSlide) {
      return NextResponse.json(
        { error: "Question and current slide are required." },
        { status: 400 },
      );
    }

    const tutor = await answerTutorQuestion({
      deckTitle: body.deckTitle ?? "Uploaded lecture deck",
      courseName: body.courseName ?? "Unknown course",
      summary: body.summary ?? "",
      studyStrategy: body.studyStrategy ?? "",
      teachingFormat: body.teachingFormat ?? "lecture",
      customInstructions: body.customInstructions ?? "",
      currentSlide,
      question: body.question.trim(),
    });

    const debug = {
      route: "/api/lecture/question",
      model: getGeneralModel(),
      durationMs: Date.now() - startedAt,
      slideNumber: currentSlide.slideNumber,
      slideTitle: currentSlide.title,
      questionPreview: body.question.trim().slice(0, 120),
      ok: true,
    };

    console.log("[aiprof] question success", debug);

    return NextResponse.json({ tutor, answer: tutor.spokenAnswer, debug });
  } catch (error) {
    const message = getErrorMessage(error);
    const debug = {
      route: "/api/lecture/question",
      model: getGeneralModel(),
      durationMs: Date.now() - startedAt,
      ok: false,
      error: message,
    };

    console.error("[aiprof] question error", debug);

    return NextResponse.json({ error: message, debug }, { status: 500 });
  }
}

function normalizeBoardContext(value: unknown, fallbackVersion: number): TutorBoardContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  const version = typeof body.version === "number" && Number.isSafeInteger(body.version)
    ? Math.max(0, body.version)
    : fallbackVersion;
  const shapes = Array.isArray(body.shapes)
    ? body.shapes
        .slice(0, 120)
        .map(normalizeSemanticShape)
        .filter((shape): shape is SemanticShape => shape !== null)
    : [];
  const imageDataUrl = typeof body.imageDataUrl === "string"
    && body.imageDataUrl.length <= 900_000
    && /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(body.imageDataUrl)
    ? body.imageDataUrl
    : undefined;
  const diff = normalizeBoardDiff(body.diff);
  return { version, shapes, diff, imageDataUrl };
}

function normalizeSemanticShape(value: unknown): SemanticShape | null {
  if (!value || typeof value !== "object") return null;
  const shape = value as Record<string, unknown>;
  if (typeof shape.id !== "string" || !shape.id.trim()) return null;
  if (typeof shape.type !== "string" || !shape.type.trim()) return null;
  return {
    id: shape.id.slice(0, 80),
    type: shape.type.slice(0, 40),
    x: typeof shape.x === "number" && Number.isFinite(shape.x) ? Math.max(0, Math.min(900, shape.x)) : 0,
    y: typeof shape.y === "number" && Number.isFinite(shape.y) ? Math.max(0, Math.min(560, shape.y)) : 0,
    props: safeShapeProps(shape.props),
  };
}

function normalizeBoardDiff(value: unknown): BoardDiff | undefined {
  if (!value || typeof value !== "object") return undefined;
  const diff = value as Record<string, unknown>;
  const version = typeof diff.version === "number" && Number.isSafeInteger(diff.version)
    ? Math.max(0, diff.version)
    : 0;
  const normalizeShapes = (items: unknown) => Array.isArray(items)
    ? items.slice(0, 60).map(normalizeSemanticShape).filter((shape): shape is SemanticShape => shape !== null)
    : [];
  const deleted = Array.isArray(diff.deleted)
    ? diff.deleted.filter((id): id is string => typeof id === "string").slice(0, 60).map((id) => id.slice(0, 80))
    : [];
  return {
    version,
    reset: diff.reset === true,
    created: normalizeShapes(diff.created),
    updated: normalizeShapes(diff.updated),
    deleted,
  };
}

function safeShapeProps(value: unknown) {
  if (!value || typeof value !== "object") return {};
  try {
    const serialized = JSON.stringify(value).slice(0, 4_000);
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function loadLearnerContext(userId: string) {
  const reviewItems = await prisma.reviewItem.findMany({
    where: { userId },
    orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
    take: 6,
    select: { conceptKey: true, latestOutcome: true, dueAt: true },
  });
  return reviewItems.map((item) => `${item.conceptKey} (${item.latestOutcome ?? "new"}, due ${item.dueAt.toISOString()})`).join("; ");
}

async function persistToolTrace(sessionId: string, response: { tutor: { spokenAnswer: string }; effects: unknown[]; toolTrace: unknown[] }) {
  if (!response.toolTrace.length && !response.effects.length) return;
  try {
    await appendSessionEvent({
      sessionId,
      kind: "text_tool_call",
      role: "assistant",
      modality: "text",
      transcript: response.tutor.spokenAnswer,
      relativeTimeMs: 0,
      payload: { toolTrace: response.toolTrace, effects: response.effects },
    });
  } catch (error) {
    console.warn("[studydeck] failed to persist text tutor tool trace", error);
  }
}
