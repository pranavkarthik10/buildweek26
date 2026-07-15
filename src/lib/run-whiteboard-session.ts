import type { LectureSlide, WhiteboardContent, WhiteboardMode } from "@/lib/aiprof-types";
import type {
  TeachingFocus,
  WhiteboardStepRecord,
  WhiteboardStepResult,
} from "@/lib/whiteboard-types";

export type WhiteboardSessionInput = {
  mode: WhiteboardMode;
  goal: string;
  title?: string;
  slide: LectureSlide;
  deckTitle?: string;
  courseName?: string;
  question?: string;
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
  const maxSteps = input.maxSteps ?? 12;
  const priorSteps: WhiteboardStepRecord[] = [];

  let content: WhiteboardContent = {
    mode: input.mode,
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
        mode: input.mode,
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

    if (input.mode === "canvas" && step.actions?.length) {
      input.applyCanvasActions?.(step.actions);
    }

    if (step.content) {
      content = { ...content, ...step.content, mode: input.mode };
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}