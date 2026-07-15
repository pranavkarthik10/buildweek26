import {
  createPartFromUri,
  GoogleGenAI,
  Modality,
  type Content,
} from "@google/genai";

import type {
  LectureBeat,
  LectureCue,
  LectureDeck,
  LectureSegment,
  LectureSlide,
  TeachingFormat,
  WhiteboardMode,
} from "@/lib/aiprof-types";
import type { TutorQuestionResult } from "@/lib/whiteboard-types";
import type { RenderedSlide } from "@/lib/pdf-slides";

const DEFAULT_GENERAL_MODEL = "gemini-3-flash-preview";
const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";

type RawLectureCue = {
  label?: unknown;
  emphasis?: unknown;
  targetBullet?: unknown;
  x?: unknown;
  y?: unknown;
};

type RawLectureSlide = {
  id?: unknown;
  slideNumber?: unknown;
  title?: unknown;
  summary?: unknown;
  bullets?: unknown[] | unknown;
  coachNote?: unknown;
  examRelevance?: unknown;
  cues?: RawLectureCue[] | RawLectureCue;
};

type RawLectureDeck = {
  deckTitle?: unknown;
  courseName?: unknown;
  summary?: unknown;
  studyStrategy?: unknown;
  slides?: RawLectureSlide[] | RawLectureSlide;
};

function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  return apiKey;
}

export function getGeneralModel() {
  return process.env.GEMINI_GENERAL_MODEL ?? DEFAULT_GENERAL_MODEL;
}

export function getLiveModel() {
  return process.env.GEMINI_LIVE_MODEL ?? DEFAULT_LIVE_MODEL;
}

export function getTtsModel() {
  return process.env.GEMINI_TTS_MODEL ?? DEFAULT_TTS_MODEL;
}

export function getGeminiClient() {
  return new GoogleGenAI({ apiKey: getApiKey() });
}

export function getGeminiLiveTokenClient() {
  return new GoogleGenAI({
    apiKey: getApiKey(),
    httpOptions: { apiVersion: "v1alpha" },
  });
}

export async function uploadPdfAndBuildLecture(
  file: File,
  renderedSlides: RenderedSlide[],
  deckId: string,
): Promise<LectureDeck> {
  const ai = getGeminiClient();
  const uploaded = await ai.files.upload({
    file,
    config: {
      mimeType: file.type || "application/pdf",
      displayName: file.name,
    },
  });

  let activeFile = uploaded;

  try {
    activeFile = await waitForActiveFile(ai, uploaded.name);

    if (!activeFile.uri || !activeFile.mimeType) {
      throw new Error("Gemini did not return a usable file URI.");
    }

    const rawDeck = await generateSlideAnnotationsFromPdf(
      ai,
      activeFile.uri,
      activeFile.mimeType,
      renderedSlides.length,
    );

    return normalizeLectureDeck(rawDeck, renderedSlides, deckId, file.name);
  } finally {
    if (activeFile.name) {
      try {
        await ai.files.delete({ name: activeFile.name });
      } catch {
        // Best-effort cleanup so uploaded PDFs do not accumulate remotely.
      }
    }
  }
}

function describeTeachingFormat(format: TeachingFormat) {
  if (format === "small_class") {
    return "small-class: moderate check-in questions and interactive pacing";
  }

  if (format === "tutoring") {
    return "1-1 tutoring: frequent follow-up questions and adaptive explanations";
  }

  return "lecture: explain continuously with minimal interruptions";
}

export async function answerLectureQuestion(input: {
  deckTitle: string;
  courseName: string;
  summary: string;
  studyStrategy: string;
  teachingFormat?: TeachingFormat;
  customInstructions?: string;
  currentSlide: LectureSlide;
  question: string;
}) {
  const { answerTutorQuestion } = await import("@/lib/whiteboard-agent");
  const result = await answerTutorQuestion({
    deckTitle: input.deckTitle,
    courseName: input.courseName,
    summary: input.summary,
    studyStrategy: input.studyStrategy,
    teachingFormat: describeTeachingFormat(input.teachingFormat ?? "lecture"),
    customInstructions: input.customInstructions,
    currentSlide: input.currentSlide,
    question: input.question,
  });

  return result as TutorQuestionResult;
}

export async function generateLectureSegment(input: {
  deckTitle: string;
  courseName: string;
  summary: string;
  studyStrategy: string;
  teachingFormat?: TeachingFormat;
  customInstructions?: string;
  currentSlide: LectureSlide;
  nextSlide?: LectureSlide;
}): Promise<LectureSegment> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: getGeneralModel(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Create a controlled live lecture plan for exactly one visible slide.",
              "The browser will show the real uploaded slide image. Do not say you are displaying or rendering it.",
              "Return JSON only.",
              "Write 1-2 focused narration beats by default. Use 3 only when the slide has distinct visual regions that need separate pointing. Each beat will be converted to TTS separately, so each one should sound complete and natural.",
              "Use point actions when the narration refers to a specific visible region, such as a diagram, formula, chart, bullet, axis, number, or phrase. Move the pointer before saying that narration. Use none only for general narration that does not depend on a location.",
              "Optional whiteboardPlan: when this slide needs an extended board explanation (not a single payload), set startAfterBeatIndex (0 = before first beat, 1 = after beat 1, etc.), mode (canvas for diagrams, latex for equations, text for steps, manim only if animation is essential), goal (what the board agent should build across many steps), and title. Omit whiteboardPlan if the slide alone is enough.",
              "Set skipSlide true only for title, agenda, duplicate, transition, or nearly empty slides that do not need explanation. If skipSlide is true, include at most one brief narration beat.",
              "You may use the next slide preview to avoid repeating yourself and to decide if this slide should be skipped or bridged quickly.",
              "Do not advance slides yourself. The client advances only after every beat finishes and the end pause completes.",
              "Keep substantial slide explanations around 25-45 seconds. Keep trivial or skipped slides under 10 seconds.",
              "Match the teaching format. Lecture mode should minimize direct questions. Small-class mode should include occasional check-ins. 1-1 tutoring should follow up frequently and adapt to the student's needs.",
              "Set askCheckpoint true only when the student should answer before continuing. Provide checkpointQuestion in that case.",
              "Use pauseAfterMs between beats for natural pauses, usually 350-900ms. Use endPauseMs for the final pause before the next slide, usually 900-1800ms.",
              `Deck: ${input.deckTitle}`,
              `Course: ${input.courseName}`,
              `Deck summary: ${input.summary}`,
              `Study strategy: ${input.studyStrategy}`,
              `Teaching format: ${describeTeachingFormat(input.teachingFormat ?? "lecture")}`,
              input.customInstructions?.trim()
                ? `Student custom instructions: ${input.customInstructions.trim()}`
                : "Student custom instructions: none",
              `Current slide number: ${input.currentSlide.slideNumber}`,
              `Current slide title: ${input.currentSlide.title}`,
              `Current slide summary: ${input.currentSlide.summary}`,
              `Current slide bullets: ${input.currentSlide.bullets.join(" | ")}`,
              `Tutor note: ${input.currentSlide.coachNote}`,
              `Cue hints: ${input.currentSlide.cues
                .map((cue) => `${cue.label}: x=${cue.x}, y=${cue.y}, emphasis=${cue.emphasis}`)
                .join("; ")}`,
              input.nextSlide
                ? `Next slide preview: ${input.nextSlide.slideNumber}. ${input.nextSlide.title} - ${input.nextSlide.summary}`
                : "This is the final slide.",
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      temperature: 0.55,
      maxOutputTokens: 3000,
      responseMimeType: "application/json",
      responseJsonSchema: lectureSegmentSchema,
    },
  });

  if (!response.text) {
    return fallbackLectureSegment(input.currentSlide);
  }

  try {
    return normalizeLectureSegment(
      parseJsonObject(response.text) as RawLectureSegment,
      input.currentSlide,
    );
  } catch (error) {
    console.error("[aiprof] lecture segment JSON parse failed", {
      error: getErrorMessage(error),
      preview: response.text.slice(0, 500),
    });

    return fallbackLectureSegment(input.currentSlide);
  }
}

export async function synthesizeLectureSpeech(input: {
  text: string;
  voiceName?: string;
}) {
  const ai = getGeminiClient();
  const text = input.text.trim();

  if (!text) {
    throw new Error("Cannot synthesize empty lecture text.");
  }

  const response = await ai.models.generateContent({
    model: getTtsModel(),
    contents: [
      [
        "Say in a warm, focused professor voice.",
        "Use natural pacing with tiny pauses around equations or key terms.",
        "Do not add words that are not in the transcript.",
        "",
        text,
      ].join("\n"),
    ],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: input.voiceName ?? "Charon",
          },
        },
      },
    },
  });

  const audio = response.data;

  if (!audio) {
    throw new Error("Gemini TTS returned no audio.");
  }

  const byteLength = Buffer.byteLength(audio, "base64");
  const durationMs = Math.max(350, Math.round((byteLength / 2 / 24000) * 1000));

  return {
    audio,
    mimeType:
      response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)
        ?.inlineData?.mimeType ?? "audio/pcm;rate=24000",
    sampleRate: 24000,
    durationMs,
    model: getTtsModel(),
  };
}

export async function* streamLectureSpeech(input: {
  text: string;
  voiceName?: string;
}) {
  const ai = getGeminiClient();
  const text = input.text.trim();

  if (!text) {
    throw new Error("Cannot synthesize empty lecture text.");
  }

  const response = await ai.models.generateContentStream({
    model: getTtsModel(),
    contents: [
      [
        "Say in a warm, focused professor voice.",
        "Use natural pacing with tiny pauses around equations or key terms.",
        "Do not add words that are not in the transcript.",
        "",
        text,
      ].join("\n"),
    ],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: input.voiceName ?? "Charon",
          },
        },
      },
    },
  });

  let totalBytes = 0;

  for await (const chunk of response) {
    const audio = chunk.data;

    if (!audio) {
      continue;
    }

    totalBytes += Buffer.byteLength(audio, "base64");

    yield {
      audio,
      sampleRate: 24000,
      mimeType:
        chunk.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)
          ?.inlineData?.mimeType ?? "audio/pcm;rate=24000",
      durationMs: Math.max(
        120,
        Math.round((Buffer.byteLength(audio, "base64") / 2 / 24000) * 1000),
      ),
      totalDurationMs: Math.max(350, Math.round((totalBytes / 2 / 24000) * 1000)),
      model: getTtsModel(),
    };
  }
}

export async function createLiveLectureToken() {
  const ai = getGeminiLiveTokenClient();
  const now = Date.now();

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      httpOptions: { apiVersion: "v1alpha" },
    },
  });

  return {
    token: token.name ?? "",
    model: getLiveModel(),
  };
}

type RawLectureBeat = {
  id?: unknown;
  narration?: unknown;
  action?: unknown;
  x?: unknown;
  y?: unknown;
  label?: unknown;
  emphasis?: unknown;
  pauseAfterMs?: unknown;
};

type RawWhiteboardPlan = {
  startAfterBeatIndex?: unknown;
  mode?: unknown;
  goal?: unknown;
  title?: unknown;
};

type RawLectureSegment = {
  slideNumber?: unknown;
  skipSlide?: unknown;
  askCheckpoint?: unknown;
  checkpointQuestion?: unknown;
  endPauseMs?: unknown;
  beats?: RawLectureBeat[] | RawLectureBeat;
  whiteboardPlan?: RawWhiteboardPlan;
};

async function generateSlideAnnotationsFromPdf(
  ai: GoogleGenAI,
  fileUri: string,
  mimeType: string,
  totalSlides: number,
) {
  const contents = [
    {
      role: "user",
      parts: [
        {
          text: [
            "Analyze this PDF as a slide deck for a live AI professor.",
            `The deck has exactly ${totalSlides} slides/pages.`,
            "Return JSON only.",
            "Preserve one object per original slide in exact order. Do not merge slides, skip slides, or invent a smaller outline.",
            "For each slide, produce title, summary, bullets, coachNote, examRelevance, and 1-3 cues.",
            "The visible slide image will be rendered separately, so your text is narration metadata only.",
          ].join("\n"),
        },
        createPartFromUri(fileUri, mimeType),
      ],
    } satisfies Content,
  ];

  try {
    const response = await ai.models.generateContent({
      model: getGeneralModel(),
      contents,
      config: {
        temperature: 0.2,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
        responseJsonSchema: lectureDeckSchema,
      },
    });

    if (!response.text) {
      throw new Error("Gemini returned an empty slide analysis.");
    }

    try {
      return parseJsonObject(response.text) as RawLectureDeck;
    } catch (parseError) {
      console.error("[aiprof] structured JSON parse failed", {
        error: getErrorMessage(parseError),
        preview: response.text.slice(0, 500),
      });

      return repairSlideAnalysisJson(ai, response.text, totalSlides);
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    if (
      !errorMessage.includes("INVALID_ARGUMENT") &&
      !errorMessage.includes("JSON")
    ) {
      throw error;
    }

    const fallbackResponse = await ai.models.generateContent({
      model: getGeneralModel(),
      contents,
      config: {
        temperature: 0.2,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
      },
    });

    if (!fallbackResponse.text) {
      throw new Error("Gemini returned an empty slide analysis.");
    }

    try {
      return parseJsonObject(fallbackResponse.text) as RawLectureDeck;
    } catch (parseError) {
      console.error("[aiprof] fallback JSON parse failed", {
        error: getErrorMessage(parseError),
        preview: fallbackResponse.text.slice(0, 500),
      });

      return repairSlideAnalysisJson(ai, fallbackResponse.text, totalSlides);
    }
  }
}

async function repairSlideAnalysisJson(
  ai: GoogleGenAI,
  malformedJson: string,
  totalSlides: number,
) {
  const repairResponse = await ai.models.generateContent({
    model: getGeneralModel(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Repair this malformed JSON into valid JSON only. Do not add markdown.",
              `The valid object must include exactly ${totalSlides} slide objects in a slides array.`,
              "Use these top-level keys: deckTitle, courseName, summary, studyStrategy, slides.",
              "Each slide object needs: id, slideNumber, title, summary, bullets, coachNote, examRelevance, cues.",
              "Each cue needs: label, emphasis, targetBullet, x, y.",
              "Malformed JSON:",
              malformedJson.slice(0, 20000),
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      temperature: 0,
      maxOutputTokens: 16384,
      responseMimeType: "application/json",
    },
  });

  if (!repairResponse.text) {
    throw new Error("Gemini returned an empty JSON repair response.");
  }

  try {
    return parseJsonObject(repairResponse.text) as RawLectureDeck;
  } catch (repairError) {
    console.error("[aiprof] repaired JSON parse failed", {
      error: getErrorMessage(repairError),
      preview: repairResponse.text.slice(0, 500),
    });

    return { slides: [] } satisfies RawLectureDeck;
  }
}

async function waitForActiveFile(ai: GoogleGenAI, name?: string) {
  if (!name) {
    throw new Error("Uploaded file is missing a remote file name.");
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const file = await ai.files.get({ name });

    if (file.state === "ACTIVE") {
      return file;
    }

    if (file.state === "FAILED") {
      throw new Error(file.error?.message || "Gemini failed to process the uploaded PDF.");
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Timed out while Gemini was processing the PDF.");
}

function normalizeLectureDeck(
  raw: RawLectureDeck,
  renderedSlides: RenderedSlide[],
  deckId: string,
  fallbackTitle: string,
): LectureDeck {
  const rawSlides = asArray(raw.slides);

  const slides = renderedSlides.map((rendered, index) => {
    const rawSlide =
      rawSlides.find((slide) => asFiniteNumber(slide.slideNumber) === rendered.slideNumber) ??
      rawSlides[index] ??
      {};

    return normalizeLectureSlide(rawSlide, rendered, index);
  });

  return {
    deckId,
    deckTitle: asCleanString(raw.deckTitle) || fallbackTitle.replace(/\.pdf$/i, ""),
    courseName: asCleanString(raw.courseName) || "Uploaded lecture deck",
    summary:
      asCleanString(raw.summary) ||
      "A slide-by-slide lecture generated from the uploaded deck.",
    studyStrategy:
      asCleanString(raw.studyStrategy) ||
      "Follow the deck in order and pause on confusing slides for questions.",
    totalSlides: renderedSlides.length,
    slides,
  };
}

function normalizeLectureSlide(
  raw: RawLectureSlide,
  rendered: RenderedSlide,
  index: number,
): LectureSlide {
  const bullets = asArray(raw.bullets)
    .map((bullet) => asCleanString(bullet))
    .filter(Boolean)
    .slice(0, 4);

  const fallbackBullets =
    bullets.length > 0 ? bullets : [`Slide ${rendered.slideNumber}`];

  const cues = asArray(raw.cues)
    .map((cue, cueIndex) => normalizeCue(cue, cueIndex, fallbackBullets.length))
    .slice(0, 3);

  return {
    ...rendered,
    id: asCleanString(raw.id) || rendered.id,
    title: asCleanString(raw.title) || `Slide ${rendered.slideNumber}`,
    summary:
      asCleanString(raw.summary) ||
      "The tutor will explain this slide in context.",
    bullets: fallbackBullets,
    coachNote:
      asCleanString(raw.coachNote) ||
      "Explain what is visually present on this slide before adding context.",
    examRelevance: normalizeExamRelevance(raw.examRelevance),
    cues:
      cues.length > 0
        ? cues
        : [
            {
              id: `cue-${index + 1}-1`,
              label: fallbackBullets[0] || "main idea",
              emphasis: "Point to the main idea on this slide.",
              targetBullet: 0,
              x: 50,
              y: 50,
            },
          ],
  };
}

function normalizeCue(
  raw: RawLectureCue,
  cueIndex: number,
  bulletCount: number,
): LectureCue {
  const safeBulletCount = Math.max(1, bulletCount);
  const requestedBullet = asFiniteNumber(raw.targetBullet) ?? cueIndex;
  const bulletIndex = Math.min(Math.max(requestedBullet, 0), safeBulletCount - 1);

  return {
    id: `cue-${cueIndex + 1}`,
    label: asCleanString(raw.label) || `focus ${cueIndex + 1}`,
    emphasis:
      asCleanString(raw.emphasis) ||
      "Pause here and explain why this part of the slide matters.",
    targetBullet: bulletIndex,
    x: clampPercent(asFiniteNumber(raw.x) ?? [28, 71, 45][bulletIndex] ?? 50),
    y: clampPercent(asFiniteNumber(raw.y) ?? [35, 52, 76][bulletIndex] ?? 50),
  };
}

function normalizeLectureSegment(
  raw: RawLectureSegment,
  slide: LectureSlide,
): LectureSegment {
  const skipSlide = raw.skipSlide === true;
  const askCheckpoint = raw.askCheckpoint === true;
  const beats = asArray(raw.beats)
    .map((beat, index) => normalizeLectureBeat(beat, index, slide))
    .filter((beat) => beat.narration)
    .slice(0, 4);

  const segment: LectureSegment = {
    slideNumber: slide.slideNumber,
    skipSlide,
    askCheckpoint,
    checkpointQuestion: askCheckpoint
      ? asCleanString(raw.checkpointQuestion) ||
        `Before we move on, what is the main idea of ${slide.title}?`
      : "",
    endPauseMs: Math.min(
      3500,
      Math.max(600, asFiniteNumber(raw.endPauseMs) ?? (skipSlide ? 700 : 1200)),
    ),
    beats: beats.length > 0 ? beats : fallbackLectureSegment(slide).beats,
  };

  const plan = normalizeWhiteboardPlan(raw.whiteboardPlan);
  if (plan) {
    segment.whiteboardPlan = plan;
  }

  return segment;
}

function normalizeWhiteboardPlan(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const plan = raw as RawWhiteboardPlan;
  const goal = asCleanString(plan.goal);
  const mode = asCleanString(plan.mode).toLowerCase() as WhiteboardMode;

  if (!goal) {
    return undefined;
  }

  if (!["canvas", "text", "latex", "manim", "strokes"].includes(mode)) {
    return undefined;
  }

  const startAfterBeatIndex = Math.max(
    0,
    Math.min(3, Math.floor(asFiniteNumber(plan.startAfterBeatIndex) ?? 0)),
  );

  return {
    startAfterBeatIndex,
    mode,
    goal,
    title: asCleanString(plan.title) || "Whiteboard",
  };
}

function normalizeLectureBeat(
  raw: RawLectureBeat,
  index: number,
  slide: LectureSlide,
): LectureBeat {
  const cue = slide.cues[index % Math.max(slide.cues.length, 1)];
  const action = asCleanString(raw.action).toLowerCase() === "point" ? "point" : "none";
  return {
    id: asCleanString(raw.id) || `beat-${slide.slideNumber}-${index + 1}`,
    narration: asCleanString(raw.narration),
    action,
    x: normalizeCoordinate(asFiniteNumber(raw.x), cue?.x ?? 50),
    y: normalizeCoordinate(asFiniteNumber(raw.y), cue?.y ?? 50),
    label: asCleanString(raw.label) || cue?.label || "Focus here",
    emphasis: asCleanString(raw.emphasis) || cue?.emphasis || slide.title,
    pauseAfterMs: Math.min(
      1200,
      Math.max(250, asFiniteNumber(raw.pauseAfterMs) ?? 500),
    ),
  };
}

function fallbackLectureSegment(slide: LectureSlide): LectureSegment {
  const cue = slide.cues[0];

  return {
    slideNumber: slide.slideNumber,
    skipSlide: false,
    askCheckpoint: false,
    checkpointQuestion: "",
    endPauseMs: 1200,
    beats: [
      {
        id: `fallback-${slide.slideNumber}-1`,
        narration: `Let's focus on slide ${slide.slideNumber}, ${slide.title}. ${slide.summary}`,
        action: cue ? "point" : "none",
        x: cue?.x ?? 50,
        y: cue?.y ?? 50,
        label: cue?.label ?? slide.title,
        emphasis: cue?.emphasis ?? slide.summary,
        pauseAfterMs: 600,
      },
      {
        id: `fallback-${slide.slideNumber}-2`,
        narration: slide.coachNote,
        action: "none",
        pauseAfterMs: 700,
      },
    ],
  };
}

export function parseJsonObject(input: string) {
  const trimmed = input.trim();

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      const objectSlice = sliceBalancedJson(trimmed, "{", "}");

      if (objectSlice) {
        return JSON.parse(objectSlice);
      }

      throw new Error(
        `Gemini returned malformed JSON. Raw preview: ${trimmed.slice(0, 240)}`,
      );
    }
  }

  const objectSlice = sliceBalancedJson(trimmed, "{", "}");

  if (objectSlice) {
    return JSON.parse(objectSlice);
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  throw new Error(
    `Gemini returned JSON in an unexpected format. Raw preview: ${trimmed.slice(0, 240)}`,
  );
}

function sliceBalancedJson(input: string, openChar: "{" | "[", closeChar: "}" | "]") {
  const start = input.indexOf(openChar);

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < input.length; i += 1) {
    const char = input[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;

      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const parts = [error.message];
    const causeMessage =
      typeof error.cause === "string"
        ? error.cause
        : error.cause && typeof error.cause === "object"
          ? JSON.stringify(error.cause)
          : "";

    if (causeMessage) {
      parts.push(causeMessage);
    }

    return parts.filter(Boolean).join(" | ");
  }

  return String(error);
}

function asCleanString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  return [value];
}

function asFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function clampPercent(value: number) {
  return Math.min(96, Math.max(4, value));
}

function normalizeCoordinate(value: number | null, fallback: number) {
  if (value == null) {
    return clampPercent(fallback);
  }

  return clampPercent(value >= 0 && value <= 1 ? value * 100 : value);
}

function normalizeExamRelevance(value: unknown): "high" | "medium" | "low" {
  const normalized = asCleanString(value).toLowerCase();

  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  return "medium";
}

const lectureDeckSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    deckTitle: { type: "string" },
    courseName: { type: "string" },
    summary: { type: "string" },
    studyStrategy: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          slideNumber: { type: "number" },
          title: { type: "string" },
          summary: { type: "string" },
          bullets: {
            type: "array",
            maxItems: 4,
            items: { type: "string" },
          },
          coachNote: { type: "string" },
          examRelevance: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          cues: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                emphasis: { type: "string" },
                targetBullet: { type: "number" },
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["label", "emphasis", "targetBullet", "x", "y"],
            },
          },
        },
        required: [
          "id",
          "slideNumber",
          "title",
          "summary",
          "bullets",
          "coachNote",
          "examRelevance",
          "cues",
        ],
      },
    },
  },
  required: ["deckTitle", "courseName", "summary", "studyStrategy", "slides"],
};

const whiteboardPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    startAfterBeatIndex: { type: "number" },
    mode: {
      type: "string",
      enum: ["canvas", "text", "latex", "manim", "strokes"],
    },
    goal: { type: "string" },
    title: { type: "string" },
  },
  required: ["startAfterBeatIndex", "mode", "goal", "title"],
};

const lectureSegmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    slideNumber: { type: "number" },
    skipSlide: { type: "boolean" },
    askCheckpoint: { type: "boolean" },
    checkpointQuestion: { type: "string" },
    endPauseMs: { type: "number" },
    whiteboardPlan: whiteboardPlanSchema,
    beats: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          narration: { type: "string" },
          action: {
            type: "string",
            enum: ["point", "none"],
          },
          x: { type: "number" },
          y: { type: "number" },
          label: { type: "string" },
          emphasis: { type: "string" },
          pauseAfterMs: { type: "number" },
        },
        required: [
          "id",
          "narration",
          "action",
          "x",
          "y",
          "label",
          "emphasis",
          "pauseAfterMs",
        ],
      },
    },
  },
  required: [
    "slideNumber",
    "skipSlide",
    "askCheckpoint",
    "checkpointQuestion",
    "endPauseMs",
    "beats",
  ],
};
