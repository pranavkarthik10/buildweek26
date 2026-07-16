import { getErrorMessage, streamLectureSpeech } from "@/lib/speech";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: string;
      voiceName?: string;
      cache?: "lecture" | "none";
    };

    if (!body.text?.trim()) {
      return Response.json(
        { error: "Missing text for speech synthesis." },
        { status: 400 },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let chunks = 0;
          let cacheHit = false;

          for await (const speech of streamLectureSpeech({
            text: body.text ?? "",
            voiceName: body.voiceName,
            cache: body.cache !== "none",
          })) {
            chunks += 1;
            cacheHit ||= speech.cacheHit === true;
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ type: "audio", ...speech })}\n`),
            );
          }

          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: "done", chunks, cacheHit })}\n`),
          );
          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "error",
                error:
                  getErrorMessage(error) || "Failed to stream lecture audio.",
                retryAfterMs: getRetryAfterMs(error) * 1000 || undefined,
              })}\n`,
            ),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    });
  } catch (error) {
    const retryAfterSeconds = getRetryAfterMs(error);

    return Response.json(
      {
        error: getErrorMessage(error) || "Failed to stream lecture audio.",
        retryAfterMs: retryAfterSeconds ? retryAfterSeconds * 1000 : undefined,
      },
      { status: retryAfterSeconds ? 429 : 500 },
    );
  }
}

function getRetryAfterMs(error: unknown) {
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
