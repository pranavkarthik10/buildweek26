import type { LectureCue, LectureDeck, LectureSlide } from "@/lib/aiprof-types";

/** Read both the current slides-array format and the early full-deck format. */
export function parsePersistedLectureDeck(input: {
  id: string;
  title: string;
  courseName?: string | null;
  summary?: string | null;
  studyStrategy?: string | null;
  totalSlides?: number;
  slides: string;
}): LectureDeck {
  const parsed = JSON.parse(input.slides) as unknown;
  const storedDeck = !Array.isArray(parsed) && parsed && typeof parsed === "object"
    ? parsed as Record<string, unknown>
    : {};
  const rawSlides = Array.isArray(parsed)
    ? parsed
    : Array.isArray(storedDeck.slides) ? storedDeck.slides : [];
  const slides = rawSlides.map(normalizeSlide).filter((slide): slide is LectureSlide => slide !== null);

  return {
    deckId: input.id,
    deckTitle: text(storedDeck.deckTitle, 240) || input.title,
    courseName: text(storedDeck.courseName, 240) || input.courseName || "",
    summary: text(storedDeck.summary, 4_000) || input.summary || "",
    studyStrategy: text(storedDeck.studyStrategy, 4_000) || input.studyStrategy || "",
    totalSlides: slides.length,
    slides,
  };
}

function normalizeSlide(value: unknown, index: number): LectureSlide | null {
  if (!value || typeof value !== "object") return null;
  const slide = value as Record<string, unknown>;
  const title = text(slide.title, 300) || `Slide ${index + 1}`;
  return {
    id: text(slide.id, 120) || `slide-${index + 1}`,
    slideNumber: safePositiveInteger(slide.slideNumber) ?? index + 1,
    imageUrl: text(slide.imageUrl, 2_000),
    title,
    summary: text(slide.summary, 6_000),
    bullets: Array.isArray(slide.bullets)
      ? slide.bullets.filter((item): item is string => typeof item === "string").slice(0, 30).map((item) => item.slice(0, 800))
      : [],
    coachNote: text(slide.coachNote, 2_000),
    examRelevance: ["high", "medium", "low"].includes(String(slide.examRelevance))
      ? slide.examRelevance as LectureSlide["examRelevance"]
      : "medium",
    cues: Array.isArray(slide.cues)
      ? slide.cues.slice(0, 40).map(normalizeCue).filter((cue): cue is LectureCue => cue !== null)
      : [],
  };
}

function normalizeCue(value: unknown, index: number): LectureCue | null {
  if (!value || typeof value !== "object") return null;
  const cue = value as Record<string, unknown>;
  return {
    id: text(cue.id, 120) || `cue-${index + 1}`,
    label: text(cue.label, 200),
    emphasis: text(cue.emphasis, 500),
    targetBullet: safeNonNegativeInteger(cue.targetBullet) ?? 0,
    x: boundedNumber(cue.x, 50),
    y: boundedNumber(cue.y, 50),
  };
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safePositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : fallback;
}
