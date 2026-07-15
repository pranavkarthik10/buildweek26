import { NextResponse } from "next/server";

import {
  createLiveLectureToken,
  getErrorMessage,
  getLiveModel,
} from "@/lib/gemini";

export async function POST() {
  const startedAt = Date.now();

  try {
    const token = await createLiveLectureToken();

    const debug = {
      route: "/api/live/token",
      model: getLiveModel(),
      durationMs: Date.now() - startedAt,
      ok: true,
    };

    console.log("[aiprof] live token success", debug);

    return NextResponse.json({ ...token, debug });
  } catch (error) {
    const message = getErrorMessage(error);
    const debug = {
      route: "/api/live/token",
      model: getLiveModel(),
      durationMs: Date.now() - startedAt,
      ok: false,
      error: message,
    };

    console.error("[aiprof] live token error", debug);

    return NextResponse.json({ error: message, debug }, { status: 500 });
  }
}
