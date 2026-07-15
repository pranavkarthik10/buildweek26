import { TeachingFormat } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";

const teachingFormats = new Set<string>(Object.values(TeachingFormat));

export async function GET() {
  const { id: userId } = await ensureLocalUser();

  const sessions = await prisma.studySession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { deck: { select: { title: true, totalSlides: true } } },
  });

  return NextResponse.json(sessions);
}

export async function POST(req: Request) {
  const { id: userId } = await ensureLocalUser();

  const body = await req.json().catch(() => null);
  if (!body?.deckId) {
    return NextResponse.json({ error: "deckId required" }, { status: 400 });
  }

  try {
    const deck = await prisma.deck.findFirst({
      where: { id: body.deckId, userId },
      select: { id: true },
    });

    if (!deck) {
      return NextResponse.json({ error: "Deck not found." }, { status: 404 });
    }

    const session = await prisma.studySession.create({
      data: {
        user: { connect: { id: userId } },
        deck: { connect: { id: deck.id } },
        teachingFormat: normalizeTeachingFormat(body.teachingFormat),
        customInstructions: normalizeCustomInstructions(body.customInstructions),
        currentSlide: 0,
        currentCue: 0,
        status: "active",
        progressPercent: 0,
      },
    });

    return NextResponse.json(session);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create session.";

    console.error("[studydeck] session create failed", {
      userId,
      deckId: body.deckId,
      error: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function normalizeTeachingFormat(value: unknown) {
  return typeof value === "string" && teachingFormats.has(value)
    ? (value as TeachingFormat)
    : TeachingFormat.lecture;
}

function normalizeCustomInstructions(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 2000) : null;
}
