import { Worker } from "bullmq";

import { renderExplainerArtifactById } from "../src/lib/render-worker";

const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) {
  throw new Error("REDIS_URL is required to start the studydeck render worker.");
}

const worker = new Worker(
  "studydeck-render",
  async (job) => {
    const artifactId = typeof job.data?.jobId === "string" ? job.data.jobId : "";
    if (!artifactId) throw new Error("Render job is missing jobId.");
    await renderExplainerArtifactById(artifactId);
  },
  {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
    concurrency: Number.parseInt(process.env.RENDER_WORKER_CONCURRENCY ?? "1", 10) || 1,
  },
);

worker.on("completed", (job) => {
  console.log(`[studydeck] render job ${job.id} completed`);
});
worker.on("failed", (job, error) => {
  console.error(`[studydeck] render job ${job?.id ?? "unknown"} failed`, error);
});

async function shutdown() {
  await worker.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log("[studydeck] render worker listening on studydeck-render");
