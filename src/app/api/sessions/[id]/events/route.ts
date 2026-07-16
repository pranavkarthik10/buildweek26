import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { appendSessionEvent } from "@/lib/session-events";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: userId } = await ensureLocalUser();
  const { id: sessionId } = await params;
  const session = await prisma.studySession.findFirst({ where: { id: sessionId, userId } });
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Event payload is required." }, { status: 400 });
  }

  const kind = text(body.kind, 80);
  const role = text(body.role, 30);
  const modality = text(body.modality, 30);
  const transcript = text(body.transcript, 20_000);
  const clientEventId = text(body.clientEventId, 120);
  if (!kind || !role || !modality) {
    return NextResponse.json({ error: "kind, role, and modality are required." }, { status: 400 });
  }
  if (clientEventId && !/^[a-zA-Z0-9._:-]+$/.test(clientEventId)) {
    return NextResponse.json({ error: "clientEventId is invalid." }, { status: 400 });
  }

  try {
    const event = await appendSessionEvent({
      sessionId,
      clientEventId: clientEventId || undefined,
      kind,
      role,
      modality,
      transcript,
      slideIndex: safeInteger(body.slideIndex),
      relativeTimeMs: safeInteger(body.relativeTimeMs),
      startedAtMs: safeInteger(body.startedAtMs),
      durationMs: safeInteger(body.durationMs),
      payload: body.payload,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch {
    if (clientEventId) {
      const retry = await prisma.sessionEvent.findUnique({
        where: { sessionId_clientEventId: { sessionId, clientEventId } },
      });
      if (retry) return NextResponse.json({ event: retry, ignored: true });
    }
    return NextResponse.json({ error: "Could not persist session event." }, { status: 409 });
  }
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
