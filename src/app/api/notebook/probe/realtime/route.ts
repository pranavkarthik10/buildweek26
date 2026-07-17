import { NextResponse } from "next/server";

import {
  buildNotebookProbeRealtimeInstructions,
  getNotebookProbeRealtimeModel,
  NOTEBOOK_PROBE_REALTIME_SECRET_TTL_SECONDS,
} from "@/lib/notebook-probe-realtime";

export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice is not available right now.", code: "OPENAI_API_KEY_MISSING" },
      { status: 503 },
    );
  }

  const model = getNotebookProbeRealtimeModel();
  const instructions = buildNotebookProbeRealtimeInstructions();

  try {
    // Load and construct the SDK only for a live request, never during build.
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const secret = await client.realtime.clientSecrets.create({
      expires_after: {
        anchor: "created_at",
        seconds: NOTEBOOK_PROBE_REALTIME_SECRET_TTL_SECONDS,
      },
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
        max_output_tokens: 500,
      },
    });

    return NextResponse.json({
      value: secret.value,
      expiresAt: secret.expires_at,
      sessionId: secret.session.id,
      model,
      instructions,
    });
  } catch (error) {
    console.error("[studydeck] notebook probe realtime client secret failed", {
      model,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json(
      { error: "Voice could not start. Please try again.", code: "REALTIME_SECRET_FAILED" },
      { status: 502 },
    );
  }
}
