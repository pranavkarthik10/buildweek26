import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { buildExplainerSpec } from "@/lib/explainer";
import { requestExplainerArtifact } from "@/lib/explainer-artifacts";
import type { ExplainerRequestInput, RenderArtifactSummary } from "@/lib/explainer-types";
import { hasExplicitVisualIntent } from "@/lib/tutor-tools";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { id: userId } = await ensureLocalUser();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON explainer request is required." }, { status: 400 });
  }

  try {
    const learnerRequest = asText((body as Record<string, unknown>).learnerRequest, 500)
      || asText((body as Record<string, unknown>).question, 500);
    if (!hasExplicitVisualIntent(learnerRequest)) {
      return NextResponse.json(
        { error: "A visual explainer requires an explicit learner request." },
        { status: 400 },
      );
    }
    const input = normalizeRequest(body as Record<string, unknown>);
    if (input.sessionId) {
      const session = await prisma.studySession.findFirst({ where: { id: input.sessionId, userId } });
      if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const { artifact, spec, created } = await requestExplainerArtifact(input);
    return NextResponse.json(toSummary(artifact, spec), { status: created ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid explainer request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function normalizeRequest(body: Record<string, unknown>): ExplainerRequestInput {
  const slideValue = body.slide;
  const slide = slideValue && typeof slideValue === "object"
    ? slideValue as Record<string, unknown>
    : undefined;

  return {
    sessionId: asText(body.sessionId, 120) || undefined,
    question: asText(body.question, 500),
    concept: asText(body.concept, 180),
    goal: asText(body.goal, 400),
    durationSec: typeof body.durationSec === "number" ? body.durationSec : undefined,
    visualStyle: asText(body.visualStyle, 20) as ExplainerRequestInput["visualStyle"],
    deckTitle: asText(body.deckTitle, 180),
    courseName: asText(body.courseName, 180),
    slide: slide
      ? {
          slideNumber: typeof slide.slideNumber === "number" ? slide.slideNumber : 0,
          title: asText(slide.title, 180),
          summary: asText(slide.summary, 1000),
          bullets: Array.isArray(slide.bullets)
            ? slide.bullets.filter((item): item is string => typeof item === "string").slice(0, 12).map((item) => item.slice(0, 300))
            : [],
          imageUrl: asText(slide.imageUrl, 1000),
        }
      : undefined,
  };
}

function asText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toSummary(
  artifact: {
    id: string;
    jobKey: string;
    status: string;
    kind: string;
    engine: string;
    artifactUrl: string | null;
    audioUrl: string | null;
    captions: string | null;
    error: string | null;
  },
  spec: ReturnType<typeof buildExplainerSpec>,
): RenderArtifactSummary & { jobId: string; url: string; spec: typeof spec } {
  return {
    id: artifact.id,
    jobId: artifact.id,
    jobKey: artifact.jobKey,
    status: artifact.status as RenderArtifactSummary["status"],
    kind: artifact.kind as RenderArtifactSummary["kind"],
    engine: artifact.engine as RenderArtifactSummary["engine"],
    artifactUrl: artifact.artifactUrl ?? undefined,
    audioUrl: artifact.audioUrl ?? undefined,
    captions: parseCaptions(artifact.captions),
    specUrl: `/api/render-jobs/${artifact.id}/spec`,
    url: artifact.artifactUrl ?? `/api/render-jobs/${artifact.id}/spec`,
    error: artifact.error ?? undefined,
    spec,
  };
}

function parseCaptions(value: string | null) {
  if (!value) return undefined;
  try { return JSON.parse(value) as RenderArtifactSummary["captions"]; } catch { return undefined; }
}
