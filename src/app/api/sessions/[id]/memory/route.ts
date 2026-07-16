import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: userId } = await ensureLocalUser();
  const { id: sessionId } = await params;
  const session = await prisma.studySession.findFirst({
    where: { id: sessionId, userId },
    select: {
      id: true,
      currentSlide: true,
      progressPercent: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      boardDocument: true,
      turns: { orderBy: { createdAt: "asc" }, take: 500 },
      events: { orderBy: { sequence: "asc" }, take: 1_000 },
      artifacts: { orderBy: { createdAt: "asc" } },
      deck: { select: { title: true, courseName: true, totalSlides: true } },
    },
  });

  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json({
    ...session,
    boardDocument: session.boardDocument
      ? { ...session.boardDocument, snapshot: safelyParse(session.boardDocument.snapshot) }
      : null,
    events: session.events.map((event) => ({
      ...event,
      payload: safelyParse(event.payload),
    })),
    artifacts: session.artifacts.map((artifact) => ({
      ...artifact,
      spec: safelyParse(artifact.spec),
    })),
  });
}

function safelyParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
