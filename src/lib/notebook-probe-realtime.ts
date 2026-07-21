import { OPENAI_REALTIME_MODEL } from "@/lib/realtime-tutor-context";

export const NOTEBOOK_PROBE_REALTIME_SECRET_TTL_SECONDS = 300;

export function getNotebookProbeRealtimeModel() {
  return process.env.OPENAI_REALTIME_MODEL?.trim() || OPENAI_REALTIME_MODEL;
}

/**
 * Realtime is used only for low-latency microphone transcription and VAD.
 * Planning, drawing, and narration run through deterministic client pipelines.
 * Keep these instructions tiny — they must never become spoken tutor copy.
 */
export function buildNotebookProbeRealtimeInstructions() {
  return [
    "This studydeck session is transcription-only.",
    "Never create an audio or text response.",
    "Never call tools or attempt to answer the learner.",
    "Only transcribe microphone input.",
  ].join("\n");
}
