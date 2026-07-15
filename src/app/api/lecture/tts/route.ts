import { NextResponse } from "next/server";

import { getErrorMessage, synthesizeLectureSpeech } from "@/lib/speech";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: string;
      voiceName?: string;
    };

    if (!body.text?.trim()) {
      return NextResponse.json(
        { error: "Missing text for speech synthesis." },
        { status: 400 },
      );
    }

    const speech = await synthesizeLectureSpeech({
      text: body.text,
      voiceName: body.voiceName,
    });

    console.log("[aiprof] tts generated", {
      chars: body.text.length,
      durationMs: speech.durationMs,
      model: speech.model,
    });

    return NextResponse.json(speech);
  } catch (error) {
    console.error("[aiprof] tts error", error);
    const retryAfterSeconds = getRetryAfterSeconds(error);
    const status = retryAfterSeconds ? 429 : 500;

    return NextResponse.json(
      {
        error: getErrorMessage(error) || "Failed to synthesize lecture audio.",
        retryAfterMs: retryAfterSeconds ? retryAfterSeconds * 1000 : undefined,
      },
      { status },
    );
  }
}

function getRetryAfterSeconds(error: unknown) {
  const message = getErrorMessage(error);
  const retryDelayMatch = message.match(/retryDelay"?\s*:?\s*"?(\d+)s/i);
  const retryInMatch = message.match(/retry in ([\d.]+)s/i);

  const seconds = Number(retryDelayMatch?.[1] ?? retryInMatch?.[1]);

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds);
  }

  return message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("Quota exceeded")
    ? 60
    : 0;
}
