import {
  getErrorMessage,
  getTtsModel as getGeminiTtsModel,
  streamLectureSpeech as streamGeminiLectureSpeech,
  synthesizeLectureSpeech as synthesizeGeminiLectureSpeech,
} from "@/lib/gemini";

const XAI_TTS_ENDPOINT = "https://api.x.ai/v1/tts";
const DEFAULT_XAI_TTS_VOICE = "leo";

type SpeechProvider = "gemini" | "xai";

type SpeechResult = {
  audio: string;
  mimeType: string;
  sampleRate: number;
  durationMs: number;
  model: string;
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
}): Promise<SpeechResult> {
  if (getSpeechProvider() === "xai") {
    return synthesizeXaiLectureSpeech(input);
  }

  return synthesizeGeminiLectureSpeech(input);
}

export async function* streamLectureSpeech(input: {
  text: string;
  voiceName?: string;
}): AsyncGenerator<SpeechResult, void, unknown> {
  if (getSpeechProvider() === "xai") {
    yield await synthesizeXaiLectureSpeech(input);
    return;
  }

  yield* streamGeminiLectureSpeech(input);
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
