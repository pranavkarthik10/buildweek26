import { SessionStatus, TeachingFormat } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";

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
  if (!body) return new NextResponse("Bad request", { status: 400 });

  const session = await prisma.studySession.findFirst({
    where: { id, userId },
    include: { deck: true },
  });
  if (!session) return new NextResponse("Not found", { status: 404 });

  const updates: Record<string, unknown> = {};
  if (typeof body.currentSlide === "number")
    updates.currentSlide = body.currentSlide;
  if (typeof body.currentCue === "number")
    updates.currentCue = body.currentCue;
  if (typeof body.progressPercent === "number")
    updates.progressPercent = body.progressPercent;
  if (typeof body.status === "string" && sessionStatuses.has(body.status)) {
    updates.status = body.status;
    if (body.status !== "completed") {
      updates.completedAt = null;
    }
  }
  if (body.completedAt) updates.completedAt = new Date(body.completedAt);
  if (typeof body.teachingFormat === "string" && teachingFormats.has(body.teachingFormat)) {
    updates.teachingFormat = body.teachingFormat;
  }
  if (typeof body.customInstructions === "string") {
    updates.customInstructions = body.customInstructions.trim().slice(0, 2000) || null;
  }

  // Update slide progress if provided
  if (typeof body.slideIndex === "number" && body.completed) {
    await prisma.slideProgress.upsert({
      where: {
        sessionId_slideIndex: {
          sessionId: id,
          slideIndex: body.slideIndex,
        },
      },
      update: { completed: true, timeSpentSec: body.timeSpentSec ?? 0 },
      create: {
        sessionId: id,
        slideIndex: body.slideIndex,
        completed: true,
        timeSpentSec: body.timeSpentSec ?? 0,
      },
    });
  }

  const updated = await prisma.studySession.update({
    where: { id },
    data: updates,
    include: { deck: true },
  });

  return NextResponse.json(updated);
}
