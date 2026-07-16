import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: userId } = await ensureLocalUser();
  const { id } = await params;
  const artifact = await prisma.artifact.findFirst({
    where: {
      OR: [
        { id, session: { is: { userId } } },
        { jobKey: id, session: { is: { userId } } },
        { id, sessionId: null },
        { jobKey: id, sessionId: null },
      ],
    },
    select: { id: true, jobKey: true, status: true, engine: true, previewUrl: true, artifactUrl: true, error: true, updatedAt: true },
  });

  if (!artifact) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });
  return NextResponse.json({
    ...artifact,
    url: artifact.artifactUrl ?? artifact.previewUrl,
  });
}
