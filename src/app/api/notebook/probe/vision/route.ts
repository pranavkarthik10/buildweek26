import { NextResponse } from "next/server";

import {
  NotebookProbeVisionError,
  probeNotebookVision,
} from "@/lib/notebook-probe-vision";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "Request body must be valid JSON.");
  }

  try {
    return NextResponse.json(await probeNotebookVision(body));
  } catch (error) {
    if (error instanceof NotebookProbeVisionError) {
      return errorResponse(error.status, error.code, error.message);
    }

    console.error("[studydeck] notebook probe route failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return errorResponse(500, "vision_unavailable", "The vision probe is temporarily unavailable.");
  }
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
