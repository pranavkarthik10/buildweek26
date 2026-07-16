import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { buildExplainerPreviewHtml } from "@/lib/explainer";
import type { ExplainerSpec } from "@/lib/explainer-types";

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
  });

  if (!artifact) return new NextResponse("Not found", { status: 404 });
  let spec: ExplainerSpec;
  try {
    spec = JSON.parse(artifact.spec) as ExplainerSpec;
  } catch {
    return new NextResponse("Artifact spec is invalid", { status: 500 });
  }

  const html = buildExplainerPreviewHtml(spec).replace(
    "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js",
    "/api/render-assets/gsap",
  );
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=60",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'self'; media-src 'self';",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
