import { prisma } from "@/lib/db";
import { buildExplainerSpec, jobKeyForSpec } from "@/lib/explainer";
import { planVisualSpec } from "@/lib/visual-planner";
import type { ExplainerRequestInput } from "@/lib/explainer-types";
import { enqueueRenderJob } from "@/lib/render-queue";
import { renderExplainerArtifactById } from "@/lib/render-worker";
import { isObjectStorageConfigured, objectExists, objectUrlForKey } from "@/lib/object-storage";

export async function requestExplainerArtifact(input: ExplainerRequestInput) {
  const deterministicSpec = buildExplainerSpec(input);
  const deterministicKey = jobKeyForSpec(deterministicSpec);
  const deterministicArtifact = await prisma.artifact.findUnique({ where: { jobKey: deterministicKey } });
  if (deterministicArtifact) return { artifact: deterministicArtifact, spec: deterministicSpec, created: false };
  const spec = await planVisualSpec(input);
  const jobKey = jobKeyForSpec(spec);
  let artifact = await prisma.artifact.findUnique({ where: { jobKey } });
  let created = false;

  if (!artifact) {
    try {
      artifact = await prisma.artifact.create({
        data: {
          sessionId: input.sessionId,
          jobKey,
          status: spec.kind === "video" ? "preview" : "completed",
          kind: spec.kind,
          engine: spec.engine,
          spec: JSON.stringify(spec),
          specVersion: spec.version,
        },
      });
      created = true;
    } catch {
      // A concurrent identical request may have won the unique job-key race.
      artifact = await prisma.artifact.findUnique({ where: { jobKey } });
      if (!artifact) throw new Error("Could not create the explainer artifact.");
    }
  }

  if (spec.kind === "video" && (created || artifact.status === "preview" || artifact.status === "failed")) {
    const artifactKey = `artifacts/${jobKey}.mp4`;
    const reusableUrl = isObjectStorageConfigured()
      && await objectExists(artifactKey)
      ? objectUrlForKey(artifactKey)
      : null;
    if (reusableUrl) {
      artifact = await prisma.artifact.update({
        where: { id: artifact.id },
        data: { status: "completed", artifactUrl: reusableUrl, error: null },
      });
    } else {
      await scheduleRender(artifact.id);
    }
    artifact = await prisma.artifact.findUnique({ where: { id: artifact.id } }) ?? artifact;
  }

  return { artifact, spec, created };
}

async function scheduleRender(artifactId: string) {
  const artifact = await prisma.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact || !["preview", "failed"].includes(artifact.status)) return;

  const priorStatus = artifact.status;
  const local = process.env.RENDER_LOCAL_ENABLED === "true";
  const canQueue = process.env.RENDER_QUEUE_ENABLED === "true" && Boolean(process.env.REDIS_URL?.trim());
  if (!local && !canQueue) return;

  const claimed = await prisma.artifact.updateMany({
    where: { id: artifact.id, status: priorStatus },
    data: { status: "queued", error: null },
  });
  if (claimed.count === 0) return;

  let queued = false;
  try {
    queued = await enqueueRenderJob({
      jobId: artifact.id,
      jobKey: artifact.jobKey,
      spec: artifact.spec,
    });
  } catch (error) {
    console.error("[studydeck] render queue unavailable", error);
  }
  if (!queued && !local) {
    await prisma.artifact.updateMany({
      where: { id: artifact.id, status: "queued" },
      data: { status: priorStatus },
    });
    return;
  }
  if (local && !queued) {
    void renderExplainerArtifactById(artifact.id).catch((error) => {
      console.error("[studydeck] local explainer render failed", error);
    });
  }
}
