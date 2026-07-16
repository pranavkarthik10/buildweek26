import { Queue } from "bullmq";

let queue: Queue | null = null;

function getQueue() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return null;
  if (!queue) {
    queue = new Queue("studydeck-render", {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
    });
  }
  return queue;
}

export async function enqueueRenderJob(input: {
  jobId: string;
  jobKey: string;
  spec: string;
}) {
  if (process.env.RENDER_QUEUE_ENABLED !== "true") return false;
  const renderQueue = getQueue();
  if (!renderQueue) return false;

  const existing = await renderQueue.getJob(input.jobId);
  if (existing) {
    const state = await existing.getState();
    if (!["completed", "failed"].includes(state)) return true;
    await existing.remove();
  }

  await renderQueue.add(
    "render-explainer",
    input,
    {
      jobId: input.jobId,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
  return true;
}
