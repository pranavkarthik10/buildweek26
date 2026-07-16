import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { validateVisualSpec } from "@/lib/visual-spec";

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
    select: { id: true, kind: true, engine: true, spec: true, artifactUrl: true, audioUrl: true, captions: true },
  });
  if (!artifact) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });

  try {
    const spec = validateVisualSpec(JSON.parse(artifact.spec));
    return NextResponse.json({
      id: artifact.id,
      kind: artifact.kind,
      engine: artifact.engine,
      spec,
      artifactUrl: artifact.artifactUrl,
      audioUrl: artifact.audioUrl,
      captions: artifact.captions ? JSON.parse(artifact.captions) : undefined,
    }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "Artifact spec is invalid." }, { status: 500 });
  }
}
