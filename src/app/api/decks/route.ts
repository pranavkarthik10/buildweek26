import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";

export async function GET() {
  const { id: userId } = await ensureLocalUser();

  const decks = await prisma.deck.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { studySessions: true } },
      studySessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return NextResponse.json(decks);
}

export async function POST(req: Request) {
  const { id: userId } = await ensureLocalUser();

  const body = await req.json().catch(() => null);
  if (!body?.title || !body?.slides || !body?.pdfUrl || !body?.totalSlides) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Sync user record
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, email: "user@example.com" },
  });

  const deck = await prisma.deck.create({
    data: {
      userId,
      title: body.title,
      courseName: body.courseName ?? null,
      summary: body.summary ?? null,
      studyStrategy: body.studyStrategy ?? null,
      pdfUrl: body.pdfUrl,
      totalSlides: body.totalSlides,
      slides: JSON.stringify(body.slides),
    },
  });

  return NextResponse.json(deck);
}
