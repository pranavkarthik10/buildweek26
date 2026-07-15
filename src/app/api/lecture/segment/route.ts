import { NextResponse } from "next/server";

import type { LectureSlide, TeachingFormat } from "@/lib/aiprof-types";
import { generateLectureSegment, getErrorMessage } from "@/lib/gemini";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      deckTitle?: string;
      courseName?: string;
      summary?: string;
      studyStrategy?: string;
      teachingFormat?: TeachingFormat;
      customInstructions?: string;
      currentSlide?: LectureSlide;
      nextSlide?: LectureSlide;
    };

    if (!body.currentSlide) {
      return NextResponse.json(
        { error: "Missing currentSlide." },
        { status: 400 },
      );
    }

    const segment = await generateLectureSegment({
      deckTitle: body.deckTitle ?? "Uploaded lecture deck",
      courseName: body.courseName ?? "Course",
      summary: body.summary ?? "",
      studyStrategy: body.studyStrategy ?? "",
      teachingFormat: body.teachingFormat ?? "lecture",
      customInstructions: body.customInstructions ?? "",
      currentSlide: body.currentSlide,
      nextSlide: body.nextSlide,
    });

    console.log("[aiprof] segment generated", {
      slide: segment.slideNumber,
      beats: segment.beats.length,
    });

    return NextResponse.json({ segment });
  } catch (error) {
    console.error("[aiprof] segment error", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Failed to generate lecture segment." },
      { status: 500 },
    );
  }
}
