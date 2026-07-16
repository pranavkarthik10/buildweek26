import {
  getErrorMessage,
  getTtsModel as getGeminiTtsModel,
  streamLectureSpeech as streamGeminiLectureSpeech,
  synthesizeLectureSpeech as synthesizeGeminiLectureSpeech,
} from "@/lib/gemini";
import {
  getOrCreateModelOutput,
  modelOutputCacheKey,
  readModelOutput,
  writeModelOutput,
} from "@/lib/model-output-cache";

const XAI_TTS_ENDPOINT = "https://api.x.ai/v1/tts";
const DEFAULT_XAI_TTS_VOICE = "leo";

type SpeechProvider = "gemini" | "xai";

const TTS_CACHE_NAMESPACE = "lecture-tts-v2";

export type SpeechResult = {
  audio: string;
  mimeType: string;
  sampleRate: number;
  durationMs: number;
  model: string;
  totalDurationMs?: number;
  cacheHit?: boolean;
};

export function getSpeechProvider(): SpeechProvider {
  return process.env.VOICE_TTS_PROVIDER === "xai" ? "xai" : "gemini";
}

export function getTtsModel() {
  return getSpeechProvider() === "xai" ? "xai-tts" : getGeminiTtsModel();
}

export async function synthesizeLectureSpeech(input: {
  text: string;
  voiceName?: string;
  cache?: boolean;
}): Promise<SpeechResult> {
  if (input.cache === false) return { ...await synthesizeUncached(input), cacheHit: false };
  const key = speechCacheKey(input);
  const cached = await getOrCreateModelOutput({
    namespace: TTS_CACHE_NAMESPACE,
    key,
    validate: isSpeechResult,
    create: () => synthesizeUncached(input),
  });
  return { ...cached.value, cacheHit: cached.cacheHit };
}

async function synthesizeUncached(input: {
  text: string;
  voiceName?: string;
}): Promise<SpeechResult> {
  if (getSpeechProvider() === "xai") {
    return synthesizeXaiLectureSpeech(input);
  }

  return synthesizeGeminiLectureSpeech(input);
}

export async function* streamLectureSpeech(input: {
  text: string;
  voiceName?: string;
  cache?: boolean;
}): AsyncGenerator<SpeechResult, void, unknown> {
  const cacheEnabled = input.cache !== false;
  const key = speechCacheKey(input);
  if (cacheEnabled) {
    const cached = await readModelOutput({
      namespace: TTS_CACHE_NAMESPACE,
      key,
      validate: isSpeechResult,
    });
    if (cached) {
      yield { ...cached, cacheHit: true };
      return;
    }
  }

  const chunks: SpeechResult[] = [];
  if (getSpeechProvider() === "xai") {
    const speech = await synthesizeXaiLectureSpeech(input);
    chunks.push(speech);
    yield { ...speech, cacheHit: false };
    if (cacheEnabled) await cacheSpeechChunks(key, chunks);
    return;
  }

  for await (const speech of streamGeminiLectureSpeech(input)) {
    chunks.push(speech);
    yield { ...speech, cacheHit: false };
  }
  if (cacheEnabled) await cacheSpeechChunks(key, chunks);
}

function speechCacheKey(input: { text: string; voiceName?: string }) {
  const provider = getSpeechProvider();
  const voice = provider === "xai"
    ? mapXaiVoice(input.voiceName)
    : input.voiceName?.trim() || "Charon";
  return modelOutputCacheKey(TTS_CACHE_NAMESPACE, {
    provider,
    model: getTtsModel(),
    voice,
    transcript: input.text.trim(),
  });
}

async function cacheSpeechChunks(key: string, chunks: SpeechResult[]) {
  if (!chunks.length) return;
  const buffers = chunks.map((chunk) => Buffer.from(chunk.audio, "base64"));
  const audio = Buffer.concat(buffers).toString("base64");
  const first = chunks[0];
  const totalDurationMs = chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.durationMs), 0);
  await writeModelOutput({
    namespace: TTS_CACHE_NAMESPACE,
    key,
    value: {
      audio,
      mimeType: first.mimeType,
      sampleRate: first.sampleRate,
      durationMs: totalDurationMs,
      totalDurationMs,
      model: first.model,
    } satisfies SpeechResult,
  });
}

function isSpeechResult(value: unknown): value is SpeechResult {
  if (!value || typeof value !== "object") return false;
  const speech = value as Partial<SpeechResult>;
  return typeof speech.audio === "string"
    && speech.audio.length > 0
    && typeof speech.mimeType === "string"
    && typeof speech.sampleRate === "number"
    && typeof speech.durationMs === "number"
    && typeof speech.model === "string";
}

async function synthesizeXaiLectureSpeech(input: {
  text: string;
  voiceName?: string;
}): Promise<SpeechResult> {
  const apiKey = process.env.XAI_API_KEY;
  const text = input.text.trim();

  if (!apiKey) {
    throw new Error("Missing XAI_API_KEY.");
  }

  if (!text) {
    throw new Error("Cannot synthesize empty lecture text.");
  }

  const response = await fetch(XAI_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: mapXaiVoice(input.voiceName),
      language: "en",
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `xAI TTS failed with ${response.status}: ${message || response.statusText}`,
    );
  }

  const mimeType = response.headers.get("content-type") ?? "audio/mpeg";
  const audioBuffer = Buffer.from(await response.arrayBuffer());

  if (!audioBuffer.byteLength) {
    throw new Error("xAI TTS returned no audio.");
  }

  return {
    audio: audioBuffer.toString("base64"),
    mimeType,
    sampleRate: 0,
    durationMs: estimateCompressedAudioDurationMs(text),
    model: getTtsModel(),
  };
}

function mapXaiVoice(voiceName?: string) {
  const voice = voiceName?.trim().toLowerCase();

  if (
    voice === "eve" ||
    voice === "ara" ||
    voice === "rex" ||
    voice === "sal" ||
    voice === "leo"
  ) {
    return voice;
  }

  return process.env.XAI_TTS_VOICE ?? DEFAULT_XAI_TTS_VOICE;
}

function estimateCompressedAudioDurationMs(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(700, Math.round((words / 150) * 60_000));
}

export { getErrorMessage };
