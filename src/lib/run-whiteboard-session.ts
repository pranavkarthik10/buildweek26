import type { LectureSlide, WhiteboardContent, WhiteboardMode } from "@/lib/aiprof-types";
import type {
  TeachingFocus,
  WhiteboardStepRecord,
  WhiteboardStepResult,
} from "@/lib/whiteboard-types";
import { hasExplicitVisualIntent } from "@/lib/tutor-tools";

export type WhiteboardSessionInput = {
  mode: WhiteboardMode;
  goal: string;
  title?: string;
  slide: LectureSlide;
  deckTitle?: string;
  courseName?: string;
  summary?: string;
  studyStrategy?: string;
  teachingFormat?: string;
  customInstructions?: string;
  question?: string;
  sessionId?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  getSnapshot?: () => string | undefined;
  onFocus?: (focus: TeachingFocus) => void;
  onContent?: (content: WhiteboardContent) => void;
  onStep?: (step: WhiteboardStepResult, index: number) => void;
  applyCanvasActions?: (
    actions: NonNullable<WhiteboardStepResult["actions"]>,
  ) => void;
};

export async function runWhiteboardSession(
  input: WhiteboardSessionInput,
): Promise<WhiteboardContent> {
  // Legacy Manim requests use the validated explainer pipeline. Legacy
  // stroke requests migrate to tldraw canvas actions instead of producing an
  // empty payload.
  if (input.mode === "manim" && hasExplicitVisualIntent(input.question ?? "")) {
    return createExplainer(input);
  }
  const effectiveMode = input.mode === "strokes" || input.mode === "manim" ? "canvas" : input.mode;
  const maxSteps = input.maxSteps ?? 12;
  const priorSteps: WhiteboardStepRecord[] = [];

  let content: WhiteboardContent = {
    mode: effectiveMode,
    title: input.title ?? "Whiteboard",
  };

  input.onContent?.(content);
  input.onFocus?.(input.mode === "canvas" ? "split" : "split");

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    if (input.signal?.aborted) {
      break;
    }

    const response = await fetch("/api/lecture/whiteboard/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: effectiveMode,
        goal: input.goal,
        slide: {
          slideNumber: input.slide.slideNumber,
          title: input.slide.title,
          summary: input.slide.summary,
          bullets: input.slide.bullets,
          coachNote: input.slide.coachNote,
        },
        deckTitle: input.deckTitle,
        courseName: input.courseName,
        summary: input.summary,
        studyStrategy: input.studyStrategy,
        teachingFormat: input.teachingFormat,
        customInstructions: input.customInstructions,
        question: input.question,
        stepIndex,
        maxSteps,
        tldrawSnapshot: input.getSnapshot?.(),
        content,
        priorSteps,
      }),
      signal: input.signal,
    });

    const payload = (await response.json()) as {
      step?: WhiteboardStepResult;
      error?: string;
    };

    if (!response.ok || !payload.step) {
      throw new Error(payload.error ?? "Whiteboard step failed.");
    }

    const step = payload.step;
    input.onFocus?.(step.focus);
    input.onStep?.(step, stepIndex);

    if (effectiveMode === "canvas" && step.actions?.length) {
      input.applyCanvasActions?.(step.actions);
    }

    if (step.content) {
      content = { ...content, ...step.content, mode: effectiveMode };
      input.onContent?.(content);
    }

    priorSteps.push({
      stepIndex,
      summary: step.stepSummary,
      narration: step.narration,
    });

    if (step.status === "done") {
      break;
    }

    await sleep(420);
  }

  return content;
}

async function createExplainer(input: WhiteboardSessionInput): Promise<WhiteboardContent> {
  const response = await fetch("/api/render-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: input.sessionId,
      learnerRequest: input.question,
      question: input.question ?? input.goal,
      concept: input.title ?? "the lesson concept",
      goal: input.goal,
      durationSec: 30,
      visualStyle: "math",
      deckTitle: input.deckTitle,
      courseName: input.courseName,
      slide: {
        slideNumber: input.slide.slideNumber,
        title: input.slide.title,
        summary: input.slide.summary,
        bullets: input.slide.bullets,
      },
    }),
    signal: input.signal,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    jobId?: string;
    status?: WhiteboardContent["explainerStatus"];
    url?: string;
    previewUrl?: string;
    artifactUrl?: string;
    error?: string;
  };
  if (!response.ok || !payload.jobId) {
    throw new Error(payload.error ?? "Could not start the visual explainer.");
  }
  const content: WhiteboardContent = {
    mode: "explainer",
    title: input.title ?? "Visual explainer",
    explainerId: payload.jobId,
    explainerStatus: payload.status ?? "queued",
    explainerUrl: payload.previewUrl ?? payload.url,
    explainerVideoUrl: payload.artifactUrl,
  };
  input.onContent?.(content);
  input.onFocus?.("whiteboard");
  return content;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
