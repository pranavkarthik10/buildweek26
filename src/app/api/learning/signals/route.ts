import { NextResponse } from "next/server";

import { ensureLocalUser } from "@/lib/local-user";
import { recordLearningSignal } from "@/lib/learning-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { id: userId } = await ensureLocalUser();
  const url = new URL(req.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "8", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, requestedLimit)) : 8;
  const dueOnly = url.searchParams.get("dueOnly") === "true";

  const { prisma } = await import("@/lib/db");
  const reviewItems = await prisma.reviewItem.findMany({
    where: {
      userId,
      ...(dueOnly ? { dueAt: { lte: new Date() } } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
    take: limit,
  });
  return NextResponse.json({ reviewItems });
}

export async function POST(req: Request) {
  const { id: userId } = await ensureLocalUser();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A learning signal is required." }, { status: 400 });
  }

  try {
    const result = await recordLearningSignal({
      userId,
      sessionId: text(body.sessionId, 120) || undefined,
      concept: text(body.concept, 180),
      outcome: text(body.outcome, 20),
      evidence: text(body.evidence, 1_500),
      misconception: text(body.misconception, 1_500) || undefined,
      preferredExplanationStyle: text(body.preferredExplanationStyle, 80) || undefined,
      prompt: text(body.prompt, 500) || undefined,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[studydeck] learning signal failed", error);
    const message = error instanceof Error ? error.message : "Could not save the learning signal.";
    return NextResponse.json({ error: message }, { status: message === "Session not found." ? 404 : 400 });
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
