import { NextResponse } from "next/server";

import type { WhiteboardStepRequest } from "@/lib/whiteboard-types";
import { runWhiteboardStep } from "@/lib/whiteboard-agent";
import { getErrorMessage } from "@/lib/gemini";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WhiteboardStepRequest;

    if (!body.mode || !body.goal?.trim() || !body.slide) {
      return NextResponse.json(
        { error: "mode, goal, and slide are required." },
        { status: 400 },
      );
    }

    const step = await runWhiteboardStep(body);

    return NextResponse.json({ step });
  } catch (error) {
    console.error("[studydeck] whiteboard step error", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Whiteboard step failed." },
      { status: 500 },
    );
  }
}