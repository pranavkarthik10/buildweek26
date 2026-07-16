import { NextResponse } from "next/server";

import type { LectureSlide, TeachingFormat } from "@/lib/aiprof-types";
import { generateLectureSegment, getErrorMessage, getGeneralModel } from "@/lib/gemini";
import { getOrCreateModelOutput, modelOutputCacheKey } from "@/lib/model-output-cache";

const LECTURE_SEGMENT_CACHE_NAMESPACE = "lecture-segment-v2";

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

    const segmentInput = {
      deckTitle: body.deckTitle ?? "Uploaded lecture deck",
      courseName: body.courseName ?? "Course",
      summary: body.summary ?? "",
      studyStrategy: body.studyStrategy ?? "",
      teachingFormat: body.teachingFormat ?? "lecture",
      customInstructions: body.customInstructions ?? "",
      currentSlide: body.currentSlide,
      nextSlide: body.nextSlide,
    };
    const cacheKey = modelOutputCacheKey(LECTURE_SEGMENT_CACHE_NAMESPACE, {
      model: getGeneralModel(),
      input: segmentInput,
    });
    const cached = await getOrCreateModelOutput({
      namespace: LECTURE_SEGMENT_CACHE_NAMESPACE,
      key: cacheKey,
      validate: isLectureSegment,
      create: () => generateLectureSegment(segmentInput),
    });
    const segment = cached.value;

    console.log("[studydeck] segment ready", {
      slide: segment.slideNumber,
      beats: segment.beats.length,
      cacheHit: cached.cacheHit,
    });

    return NextResponse.json({
      segment,
      cache: { hit: cached.cacheHit, key: cacheKey.slice(0, 12) },
    });
  } catch (error) {
    console.error("[aiprof] segment error", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Failed to generate lecture segment." },
      { status: 500 },
    );
  }
}

function isLectureSegment(value: unknown): value is Awaited<ReturnType<typeof generateLectureSegment>> {
  if (!value || typeof value !== "object") return false;
  const segment = value as { slideNumber?: unknown; beats?: unknown };
  return typeof segment.slideNumber === "number"
    && Number.isSafeInteger(segment.slideNumber)
    && Array.isArray(segment.beats)
    && segment.beats.every((beat) => Boolean(beat) && typeof beat === "object");
}
