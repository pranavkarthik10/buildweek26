import { SessionStatus, TeachingFormat } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { isNewerProgressSequence } from "@/lib/progress-sequencing";

const teachingFormats = new Set<string>(Object.values(TeachingFormat));
const sessionStatuses = new Set<string>(Object.values(SessionStatus));

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await ensureLocalUser();

  const { id } = await params;
  const session = await prisma.studySession.findFirst({
    where: { id, userId },
    include: { deck: true },
  });

  if (!session) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json(session);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await ensureLocalUser();

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return new NextResponse("Bad request", { status: 400 });
  }

  const session = await prisma.studySession.findFirst({
    where: { id, userId },
    include: { deck: true },
  });
  if (!session) return new NextResponse("Not found", { status: 404 });

  const currentSlide = safeInteger(body.currentSlide);
  const currentCue = safeInteger(body.currentCue);
  const progressPercent = safeInteger(body.progressPercent);
  const eventSeq = safeInteger(body.eventSeq);

  if (currentSlide !== null && (currentSlide < 0 || currentSlide >= session.deck.totalSlides)) {
    return NextResponse.json({ error: "currentSlide is outside the deck." }, { status: 400 });
  }
  if (currentCue !== null && currentCue < 0) {
    return NextResponse.json({ error: "currentCue must be non-negative." }, { status: 400 });
  }
  if (progressPercent !== null && (progressPercent < 0 || progressPercent > 100)) {
    return NextResponse.json({ error: "progressPercent must be between 0 and 100." }, { status: 400 });
  }

  if (eventSeq !== null && eventSeq < 0) {
    return NextResponse.json({ error: "eventSeq must be non-negative." }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (currentSlide !== null) updates.currentSlide = currentSlide;
  if (currentCue !== null) updates.currentCue = currentCue;
  if (progressPercent !== null) updates.progressPercent = progressPercent;
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !sessionStatuses.has(body.status)) {
      return NextResponse.json({ error: "status is invalid." }, { status: 400 });
    }
    updates.status = body.status;
    if (body.status !== "completed") updates.completedAt = null;
  }
  if (body.completedAt !== undefined && body.completedAt !== null) {
    if (typeof body.completedAt !== "string" || Number.isNaN(Date.parse(body.completedAt))) {
      return NextResponse.json({ error: "completedAt must be an ISO date." }, { status: 400 });
    }
    updates.completedAt = new Date(body.completedAt);
  }
  if (typeof body.teachingFormat === "string" && teachingFormats.has(body.teachingFormat)) {
    updates.teachingFormat = body.teachingFormat;
  }
  if (typeof body.customInstructions === "string") {
    updates.customInstructions = body.customInstructions.trim().slice(0, 2000) || null;
  }

  if (typeof body.boardSnapshot === "string") {
    if (body.boardSnapshot.length > 2_000_000) {
      return NextResponse.json({ error: "boardSnapshot is too large." }, { status: 413 });
    }
    updates.boardSnapshot = body.boardSnapshot;
  }

  const boardVersion = safeInteger(body.boardVersion);
  if (boardVersion !== null) {
    if (boardVersion < session.boardVersion) {
      return NextResponse.json(
        { error: "Board version is stale.", boardVersion: session.boardVersion },
        { status: 409 },
      );
    }
    updates.boardVersion = boardVersion;
  }

  // Progress has its own monotonic stream. Realtime transcript events use
  // lastEventSeq and must not make a later progress save look stale.

  // Validate the slide progress input before claiming the event. The actual
  // upsert happens only after the monotonic event check so a late request
  // cannot roll back time spent or completion metadata.
  const slideIndex = safeInteger(body.slideIndex);
  if (slideIndex !== null && (slideIndex < 0 || slideIndex >= session.deck.totalSlides)) {
    return NextResponse.json({ error: "slideIndex is outside the deck." }, { status: 400 });
  }

  if (eventSeq !== null) {
    if (!isNewerProgressSequence(session.lastProgressSeq, eventSeq)) {
      const latest = await prisma.studySession.findFirst({
        where: { id, userId },
        include: { deck: true },
      });
      return NextResponse.json({ ...latest, ignored: true });
    }
    const claimed = await prisma.studySession.updateMany({
      where: { id, userId, lastProgressSeq: { lt: eventSeq } },
      data: { ...updates, lastProgressSeq: eventSeq },
    });

    if (claimed.count === 0) {
      const latest = await prisma.studySession.findFirst({
        where: { id, userId },
        include: { deck: true },
      });
      return NextResponse.json({ ...latest, ignored: true });
    }
  } else {
    await prisma.studySession.update({ where: { id }, data: updates });
  }

  if (typeof body.boardSnapshot === "string" || boardVersion !== null) {
    await prisma.boardDocument.upsert({
      where: { sessionId: id },
      update: {
        snapshot: typeof body.boardSnapshot === "string"
          ? body.boardSnapshot
          : session.boardSnapshot ?? "",
        version: boardVersion ?? session.boardVersion,
      },
      create: {
        sessionId: id,
        snapshot: typeof body.boardSnapshot === "string"
          ? body.boardSnapshot
          : session.boardSnapshot ?? "",
        version: boardVersion ?? session.boardVersion,
      },
    });
  }

  if (slideIndex !== null && body.completed === true) {
    const timeSpentSec = safeInteger(body.timeSpentSec) ?? 0;
    await prisma.slideProgress.upsert({
      where: {
        sessionId_slideIndex: {
          sessionId: id,
          slideIndex,
        },
      },
      update: { completed: true, timeSpentSec: Math.max(0, timeSpentSec) },
      create: {
        sessionId: id,
        slideIndex,
        completed: true,
        timeSpentSec: Math.max(0, timeSpentSec),
      },
    });
  }

  const updated = await prisma.studySession.findFirst({
    where: { id, userId },
    include: { deck: true },
  });

  return NextResponse.json(updated);
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
