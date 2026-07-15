import { NextResponse } from "next/server";

import type { LectureSlide, TeachingFormat } from "@/lib/aiprof-types";
import { getErrorMessage, getGeneralModel } from "@/lib/gemini";
import { answerTutorQuestion } from "@/lib/whiteboard-agent";

type QuestionPayload = {
  deckTitle?: string;
  courseName?: string;
  summary?: string;
  studyStrategy?: string;
  teachingFormat?: TeachingFormat;
  customInstructions?: string;
  currentSlide?: LectureSlide;
  currentStop?: LectureSlide;
  question?: string;
};

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as QuestionPayload;

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
