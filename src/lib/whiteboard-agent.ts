import { getGeminiClient, getGeneralModel, getErrorMessage, parseJsonObject } from "@/lib/gemini";
import type { AgentWhiteboardMode, WhiteboardContent, WhiteboardMode } from "@/lib/aiprof-types";
import type {
  TeachingFocus,
  TutorQuestionResult,
  WhiteboardCanvasAction,
  WhiteboardStepRequest,
  WhiteboardStepResult,
} from "@/lib/whiteboard-types";

const DEFAULT_MAX_STEPS = 12;

const whiteboardStepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["continue", "done"] },
    focus: { type: "string", enum: ["slides", "whiteboard", "split"] },
    stepSummary: { type: "string" },
    narration: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["text", "geo", "arrow", "draw"] },
          id: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          text: { type: "string" },
          geo: { type: "string", enum: ["rectangle", "ellipse", "triangle"] },
          color: { type: "string" },
          points: {
            type: "array",
            items: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
            },
          },
        },
        required: ["type", "id"],
      },
    },
    content: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["text", "latex", "manim", "strokes", "canvas"],
        },
        title: { type: "string" },
        text: { type: "string" },
        latex: { type: "string" },
        manimCode: { type: "string" },
      },
      required: ["mode", "title"],
    },
  },
  required: ["status", "focus", "stepSummary"],
};

const tutorQuestionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    spokenAnswer: { type: "string" },
    focus: { type: "string", enum: ["slides", "whiteboard", "split"] },
    whiteboard: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        mode: {
          type: "string",
          enum: ["canvas", "text", "latex", "manim", "strokes"],
        },
        goal: { type: "string" },
        title: { type: "string" },
      },
      required: ["enabled", "mode", "goal"],
    },
  },
  required: ["spokenAnswer", "focus"],
};

export async function runWhiteboardStep(
  input: WhiteboardStepRequest,
): Promise<WhiteboardStepResult> {
  const ai = getGeminiClient();
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const prior = (input.priorSteps ?? [])
    .map((s) => `Step ${s.stepIndex}: ${s.summary}`)
    .join("\n");

  const response = await ai.models.generateContent({
    model: getGeneralModel(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You are a professor using a whiteboard beside lecture slides. Execute ONE step of a multi-step board session.",
              "Return JSON only. Use status done when the explanation on the board is complete.",
              "Coordinates are 0-100 (percent of board). For canvas mode, emit a few actions per step (text, geo, arrow). Build up diagrams incrementally across steps.",
              "For text mode, set content.text with cumulative notes (include prior content plus new lines).",
              "For latex mode, set content.latex with cumulative LaTeX (no delimiters).",
              "For manim mode, set content.manimCode (full scene, refine each step until done).",
              "Use focus split while drawing alongside slides; whiteboard when the board should dominate; slides when done and student should look back at the slide.",
              `Board mode: ${input.mode}`,
              `Goal: ${input.goal}`,
              `Step: ${input.stepIndex + 1} of max ${maxSteps}`,
              `Slide ${input.slide.slideNumber}: ${input.slide.title}`,
              `Slide summary: ${input.slide.summary}`,
              `Bullets: ${input.slide.bullets.join(" | ")}`,
              input.question ? `Student question: ${input.question}` : "",
              prior ? `Prior steps:\n${prior}` : "Prior steps: none",
              input.content?.text ? `Current text board:\n${input.content.text}` : "",
              input.content?.latex ? `Current latex board:\n${input.content.latex}` : "",
              input.tldrawSnapshot
                ? "Canvas has existing shapes (snapshot provided); add to the diagram, do not restart unless necessary."
                : "Canvas is empty.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
    config: {
      temperature: 0.45,
      maxOutputTokens: 2500,
      responseMimeType: "application/json",
      responseJsonSchema: whiteboardStepSchema,
    },
  });

  if (!response.text) {
    return fallbackStep(input);
  }

  try {
    return normalizeWhiteboardStep(
      parseJsonObject(response.text) as Record<string, unknown>,
      input.mode,
    );
  } catch (error) {
    console.error("[studydeck] whiteboard step parse failed", {
      error: getErrorMessage(error),
      preview: response.text.slice(0, 400),
    });
    return fallbackStep(input);
  }
}

export async function answerTutorQuestion(input: {
  deckTitle: string;
  courseName: string;
  summary: string;
  studyStrategy: string;
  teachingFormat?: string;
  customInstructions?: string;
  currentSlide: {
    slideNumber: number;
    title: string;
    summary: string;
    bullets: string[];
    coachNote: string;
  };
  question: string;
}): Promise<TutorQuestionResult> {
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: getGeneralModel(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You are an AI professor interrupted by a student during a live lecture.",
              "Return JSON only.",
              "spokenAnswer: what you say out loud (concise, conversational).",
              "focus: slides (answer refers only to slide), split (slide + board), or whiteboard (move to board-first explanation).",
              "whiteboard: set enabled true when a multi-step board explanation is needed (derivations, diagrams, worked examples). Provide mode and goal for a separate board agent. Use canvas for diagrams, latex for equations, text for bullet steps, manim only if animation is essential.",
              "If the slide alone is enough, set whiteboard.enabled false.",
              `Deck: ${input.deckTitle}`,
              `Course: ${input.courseName}`,
              `Slide: ${input.currentSlide.slideNumber} — ${input.currentSlide.title}`,
              `Summary: ${input.currentSlide.summary}`,
              `Bullets: ${input.currentSlide.bullets.join(" | ")}`,
              `Question: ${input.question}`,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      temperature: 0.4,
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
      responseJsonSchema: tutorQuestionSchema,
    },
  });

  if (!response.text) {
    return {
      spokenAnswer: "Let me think about that and tie it back to the slide.",
      focus: "slides",
    };
  }

  try {
    return normalizeTutorQuestion(parseJsonObject(response.text) as Record<string, unknown>);
  } catch {
    return {
      spokenAnswer: response.text.trim(),
      focus: "slides",
    };
  }
}

function normalizeWhiteboardStep(
  raw: Record<string, unknown>,
  mode: WhiteboardMode,
): WhiteboardStepResult {
  const status = asString(raw.status) === "done" ? "done" : "continue";
  const focus = normalizeFocus(raw.focus);

  const result: WhiteboardStepResult = {
    status,
    focus,
    stepSummary: asString(raw.stepSummary) || "Updated the board.",
    narration: asString(raw.narration) || undefined,
  };

  if (mode === "canvas" && Array.isArray(raw.actions)) {
    result.actions = raw.actions
      .map((action) => normalizeCanvasAction(action))
      .filter((action): action is WhiteboardCanvasAction => action !== null);
  }

  if (raw.content && typeof raw.content === "object") {
    const content = normalizeStepContent(raw.content as Record<string, unknown>, mode);
    if (content) {
      result.content = content;
    }
  }

  return result;
}

function normalizeTutorQuestion(raw: Record<string, unknown>): TutorQuestionResult {
  const spokenAnswer = asString(raw.spokenAnswer) || "Good question — let me explain.";
  const focus = normalizeFocus(raw.focus);
  const result: TutorQuestionResult = { spokenAnswer, focus };

  if (raw.whiteboard && typeof raw.whiteboard === "object") {
    const board = raw.whiteboard as Record<string, unknown>;
    if (board.enabled === true) {
      const mode = asString(board.mode).toLowerCase() as AgentWhiteboardMode;
      const goal = asString(board.goal);
      if (goal && isAgentMode(mode)) {
        result.whiteboard = {
          enabled: true,
          mode,
          goal,
          title: asString(board.title) || "Explanation",
        };
      }
    }
  }

  return result;
}

function normalizeStepContent(
  raw: Record<string, unknown>,
  fallbackMode: WhiteboardMode,
): WhiteboardContent | null {
  const mode = (asString(raw.mode) || fallbackMode) as WhiteboardMode;
  const title = asString(raw.title) || "Whiteboard";

  if (mode === "text") {
    const text = asString(raw.text);
    if (!text) return null;
    return { mode, title, text };
  }

  if (mode === "latex") {
    const latex = asString(raw.latex);
    if (!latex) return null;
    return { mode, title, latex };
  }

  if (mode === "manim") {
    const manimCode = asString(raw.manimCode);
    if (!manimCode) return null;
    return { mode, title, manimCode };
  }

  return { mode, title };
}

function normalizeCanvasAction(raw: unknown): WhiteboardCanvasAction | null {
  if (!raw || typeof raw !== "object") return null;
  const action = raw as Record<string, unknown>;
  const type = asString(action.type);
  const id = asString(action.id);
  if (!id) return null;

  if (type === "text") {
    const text = asString(action.text);
    const x = asNumber(action.x);
    const y = asNumber(action.y);
    if (!text || x === null || y === null) return null;
    return { type: "text", id, x, y, text, color: asString(action.color) || undefined };
  }

  if (type === "geo") {
    const x = asNumber(action.x);
    const y = asNumber(action.y);
    const w = asNumber(action.w);
    const h = asNumber(action.h);
    const geo = asString(action.geo);
    if (x === null || y === null || w === null || h === null) return null;
    if (!["rectangle", "ellipse", "triangle"].includes(geo)) return null;
    return {
      type: "geo",
      id,
      x,
      y,
      w,
      h,
      geo: geo as "rectangle" | "ellipse" | "triangle",
      color: asString(action.color) || undefined,
    };
  }

  if (type === "arrow") {
    const x1 = asNumber(action.x1);
    const y1 = asNumber(action.y1);
    const x2 = asNumber(action.x2);
    const y2 = asNumber(action.y2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { type: "arrow", id, x1, y1, x2, y2, color: asString(action.color) || undefined };
  }

  if (type === "draw" && Array.isArray(action.points)) {
    const points = action.points
      .map((point) => {
        if (!point || typeof point !== "object") return null;
        const p = point as Record<string, unknown>;
        const x = asNumber(p.x);
        const y = asNumber(p.y);
        if (x === null || y === null) return null;
        return { x, y };
      })
      .filter((p): p is { x: number; y: number } => p !== null);

    if (points.length < 2) return null;
    return { type: "draw", id, points, color: asString(action.color) || undefined };
  }

  return null;
}

function fallbackStep(input: WhiteboardStepRequest): WhiteboardStepResult {
  if (input.mode === "text") {
    return {
      status: "done",
      focus: "split",
      stepSummary: "Added notes",
      content: {
        mode: "text",
        title: "Notes",
        text: input.goal,
      },
    };
  }

  return {
    status: "done",
    focus: "split",
    stepSummary: "Finished board step",
  };
}

function normalizeFocus(value: unknown): TeachingFocus {
  const focus = asString(value);
  if (focus === "whiteboard" || focus === "split") return focus;
  return "slides";
}

function isAgentMode(mode: string): mode is AgentWhiteboardMode {
  return ["canvas", "text", "latex", "manim", "strokes"].includes(mode);
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}