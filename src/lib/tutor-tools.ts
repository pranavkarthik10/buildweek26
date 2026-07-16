import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";

import type { LectureDeck, LectureSlide } from "@/lib/aiprof-types";
import type { WhiteboardCanvasAction, TeachingFocus, TutorQuestionResult } from "@/lib/whiteboard-types";
import type { BoardTransaction } from "@/lib/whiteboard-transaction";
import type { CaptionBeat, VisualArtifactKind, VisualEngine } from "@/lib/explainer-types";

export const tutorToolNames = [
  "set_teaching_focus",
  "navigate_slide",
  "point_to_slide",
  "read_whiteboard",
  "mutate_whiteboard",
  "search_course_material",
  "create_micro_explainer",
  "record_learning_signal",
] as const;

export type TutorToolName = (typeof tutorToolNames)[number];

export type SemanticShape = {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
};

export type BoardDiff = {
  version: number;
  reset: boolean;
  created: SemanticShape[];
  updated: SemanticShape[];
  deleted: string[];
};

export type TutorBoardContext = {
  version: number;
  shapes: SemanticShape[];
  diff?: BoardDiff;
  imageDataUrl?: string;
};

export type TutorContext = {
  sessionId?: string;
  /** The learner-authored request, kept separate from model-generated tool arguments. */
  learnerQuestion?: string;
  deck: LectureDeck;
  currentSlideIndex: number;
  currentSlide: LectureSlide;
  teachingFormat?: string;
  customInstructions?: string;
  learnerContext?: string;
  board?: TutorBoardContext;
  visualIntent?: boolean;
};

export type TutorEffect =
  | { type: "set_teaching_focus"; mode: TeachingFocus }
  | { type: "navigate_slide"; slideIndex: number }
  | { type: "point_to_slide"; slideIndex: number; x: number; y: number; label: string }
  | { type: "mutate_whiteboard"; transaction: BoardTransaction; explanation?: string; presentation?: "split" | "whiteboard"; presentationReason?: "single_edit" | "multi_step" | "artifact_playback" | "user_requested" }
  | { type: "create_micro_explainer"; jobId: string; status: string; kind?: VisualArtifactKind; engine?: VisualEngine; url?: string; specUrl?: string; audioUrl?: string; captions?: CaptionBeat[] };

export type TutorToolTrace = {
  name: TutorToolName;
  status: "completed" | "failed";
  error?: string;
};

export type TextTutorResponse = {
  tutor: TutorQuestionResult;
  effects: TutorEffect[];
  toolTrace: TutorToolTrace[];
};

/** Bound client canvas data before it is exposed to either tutor model. */
export function boundSemanticShapes(shapes: SemanticShape[], limit = 120): SemanticShape[] {
  return shapes.slice(0, Math.max(0, limit)).map((shape) => ({
    id: String(shape.id).slice(0, 80),
    type: String(shape.type).slice(0, 40),
    x: Number.isFinite(shape.x) ? Math.max(-10_000, Math.min(10_000, shape.x)) : 0,
    y: Number.isFinite(shape.y) ? Math.max(-10_000, Math.min(10_000, shape.y)) : 0,
    props: boundShapeProps(shape.props),
  }));
}

function boundShapeProps(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 4_000) return { summary: serialized.slice(0, 3_900) };
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const focusSchema = z.object({ mode: z.enum(["slides", "split", "whiteboard"]) }).strict();
const navigateSchema = z.object({ slideIndex: z.number().int().min(0) }).strict();
const pointSchema = z.object({
  slideIndex: z.number().int().min(0).optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  label: z.string().trim().min(1).max(120),
}).strict();
const readBoardSchema = z.object({
  includeImage: z.boolean().optional(),
  sinceVersion: z.number().int().min(0).optional(),
}).strict();
const boardOperationSchema = z.object({
  type: z.enum(["text", "geo", "arrow", "draw"]),
  id: z.string().trim().min(1).max(80),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  x1: z.number().min(0).max(100).optional(),
  y1: z.number().min(0).max(100).optional(),
  x2: z.number().min(0).max(100).optional(),
  y2: z.number().min(0).max(100).optional(),
  w: z.number().min(0).max(100).optional(),
  h: z.number().min(0).max(100).optional(),
  geo: z.enum(["rectangle", "ellipse", "triangle"]).optional(),
  text: z.string().max(600).optional(),
  color: z.string().max(30).optional(),
  points: z.array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).max(80).optional(),
}).strict();
const mutateBoardSchema = z.object({
  transactionId: z.string().trim().min(1).max(96),
  baseVersion: z.number().int().min(0),
  explanation: z.string().max(240).optional(),
  presentation: z.enum(["split", "whiteboard"]).default("split"),
  presentationReason: z.enum(["single_edit", "multi_step", "artifact_playback", "user_requested"]).default("single_edit"),
  ops: z.array(boardOperationSchema).min(1).max(12),
}).strict();
const searchSchema = z.object({ query: z.string().trim().min(1).max(240), limit: z.number().int().min(1).max(5).optional() }).strict();
const explainerSchema = z.object({
  question: z.string().trim().min(1).max(500),
  concept: z.string().trim().min(1).max(180),
  goal: z.string().trim().min(1).max(400),
  durationSec: z.union([z.literal(15), z.literal(30), z.literal(45)]),
  visualStyle: z.enum(["clean", "chalk", "math", "diagram"]).optional(),
}).strict();
const learningSignalSchema = z.object({
  concept: z.string().trim().min(1).max(180),
  outcome: z.enum(["correct", "partial", "incorrect", "uncertain"]),
  evidence: z.string().trim().min(1).max(1_500),
  misconception: z.string().max(1_500).optional(),
  preferredExplanationStyle: z.string().max(80).optional(),
}).strict();

/** The canonical runtime schemas shared by Gemini and Realtime tool adapters. */
export const tutorToolSchemas = {
  set_teaching_focus: focusSchema,
  navigate_slide: navigateSchema,
  point_to_slide: pointSchema,
  read_whiteboard: readBoardSchema,
  mutate_whiteboard: mutateBoardSchema,
  search_course_material: searchSchema,
  create_micro_explainer: explainerSchema,
  record_learning_signal: learningSignalSchema,
} as const;

export type TutorToolArgs =
  | z.infer<typeof focusSchema>
  | z.infer<typeof navigateSchema>
  | z.infer<typeof pointSchema>
  | z.infer<typeof readBoardSchema>
  | z.infer<typeof mutateBoardSchema>
  | z.infer<typeof searchSchema>
  | z.infer<typeof explainerSchema>
  | z.infer<typeof learningSignalSchema>;

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export function getTutorToolDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: "set_teaching_focus",
      description: "Choose whether the learner should look at slides, the whiteboard, or both.",
      parametersJsonSchema: objectSchema({ mode: { type: "string", enum: ["slides", "split", "whiteboard"] } }, ["mode"]),
    },
    {
      name: "navigate_slide",
      description: "Move to a relevant slide in the current course deck.",
      parametersJsonSchema: objectSchema({ slideIndex: { type: "integer", minimum: 0 } }, ["slideIndex"]),
    },
    {
      name: "point_to_slide",
      description: "Point to a precise normalized location on a slide while explaining it.",
      parametersJsonSchema: objectSchema({
        slideIndex: { type: "integer", minimum: 0 },
        x: { type: "number", minimum: 0, maximum: 100 },
        y: { type: "number", minimum: 0, maximum: 100 },
        label: { type: "string", minLength: 1, maxLength: 120 },
      }, ["x", "y", "label"]),
    },
    {
      name: "read_whiteboard",
      description: "Read semantic whiteboard shapes and recent changes before correcting the board.",
      parametersJsonSchema: objectSchema({
        includeImage: { type: "boolean" },
        sinceVersion: { type: "integer", minimum: 0 },
      }, []),
    },
    {
      name: "mutate_whiteboard",
      description: "Apply a small additive, version-checked whiteboard transaction while preserving student work.",
      parametersJsonSchema: objectSchema({
        transactionId: { type: "string", minLength: 1, maxLength: 96 },
        baseVersion: { type: "integer", minimum: 0 },
        explanation: { type: "string", maxLength: 240 },
        presentation: { type: "string", enum: ["split", "whiteboard"] },
        presentationReason: { type: "string", enum: ["single_edit", "multi_step", "artifact_playback", "user_requested"] },
        ops: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["text", "geo", "arrow", "draw"] },
              id: { type: "string", minLength: 1, maxLength: 80 },
              x: { type: "number", minimum: 0, maximum: 100 },
              y: { type: "number", minimum: 0, maximum: 100 },
              x1: { type: "number", minimum: 0, maximum: 100 },
              y1: { type: "number", minimum: 0, maximum: 100 },
              x2: { type: "number", minimum: 0, maximum: 100 },
              y2: { type: "number", minimum: 0, maximum: 100 },
              w: { type: "number", minimum: 0, maximum: 100 },
              h: { type: "number", minimum: 0, maximum: 100 },
              geo: { type: "string", enum: ["rectangle", "ellipse", "triangle"] },
              text: { type: "string", maxLength: 600 },
              color: { type: "string", maxLength: 30 },
              points: {
                type: "array",
                maxItems: 80,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    x: { type: "number", minimum: 0, maximum: 100 },
                    y: { type: "number", minimum: 0, maximum: 100 },
                  },
                  required: ["x", "y"],
                },
              },
            },
            required: ["type", "id"],
          },
        },
      }, ["transactionId", "baseVersion", "ops"]),
    },
    {
      name: "search_course_material",
      description: "Find relevant slides in the uploaded course material.",
      parametersJsonSchema: objectSchema({ query: { type: "string", minLength: 1, maxLength: 240 }, limit: { type: "integer", minimum: 1, maximum: 5 } }, ["query"]),
    },
    {
      name: "create_micro_explainer",
      description: "Create a short visual explainer only when the learner explicitly asks for an animation, diagram, or visual proof.",
      parametersJsonSchema: objectSchema({
        question: { type: "string", minLength: 1, maxLength: 500 },
        concept: { type: "string", minLength: 1, maxLength: 180 },
        goal: { type: "string", minLength: 1, maxLength: 400 },
        durationSec: { type: "integer", enum: [15, 30, 45] },
        visualStyle: { type: "string", enum: ["clean", "chalk", "math", "diagram"] },
      }, ["question", "concept", "goal", "durationSec"]),
    },
    {
      name: "record_learning_signal",
      description: "Record evidence of what the learner understood or misunderstood.",
      parametersJsonSchema: objectSchema({
        concept: { type: "string", minLength: 1, maxLength: 180 },
        outcome: { type: "string", enum: ["correct", "partial", "incorrect", "uncertain"] },
        evidence: { type: "string", minLength: 1, maxLength: 1500 },
        misconception: { type: "string", maxLength: 1500 },
        preferredExplanationStyle: { type: "string", maxLength: 80 },
      }, ["concept", "outcome", "evidence"]),
    },
  ];
}

export function validateTutorToolArgs(name: TutorToolName, args: unknown):
  | { success: true; data: TutorToolArgs }
  | { success: false; error: unknown } {
  switch (name) {
    case "set_teaching_focus": return toolParse(focusSchema.safeParse(args));
    case "navigate_slide": return toolParse(navigateSchema.safeParse(args));
    case "point_to_slide": return toolParse(pointSchema.safeParse(args));
    case "read_whiteboard": return toolParse(readBoardSchema.safeParse(args));
    case "mutate_whiteboard": return toolParse(mutateBoardSchema.safeParse(args));
    case "search_course_material": return toolParse(searchSchema.safeParse(args));
    case "create_micro_explainer": return toolParse(explainerSchema.safeParse(args));
    case "record_learning_signal": return toolParse(learningSignalSchema.safeParse(args));
  }
}

function toolParse(result: { success: true; data: unknown } | { success: false; error: unknown }) {
  return result.success
    ? { success: true as const, data: result.data as TutorToolArgs }
    : { success: false as const, error: result.error };
}

export function isTutorToolName(value: unknown): value is TutorToolName {
  return typeof value === "string" && (tutorToolNames as readonly string[]).includes(value);
}

export function hasExplicitVisualIntent(question: string, visualIntent?: boolean) {
  if (visualIntent) return true;
  return /animate|animation|visual|diagram|draw|show me|visuali[sz]e|proof|as a video|make it visual/i.test(question);
}

const searchStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from",
  "how", "i", "in", "is", "it", "me", "of", "on", "or", "show", "slide", "the",
  "this", "to", "what", "when", "where", "why", "with", "you",
]);

/** Deterministic course search shared by Gemini and the browser Realtime tools. */
export function searchCourseMaterial(deck: LectureDeck, query: string, limit = 3) {
  const normalizedQuery = query.toLowerCase().trim();
  const terms = normalizedQuery
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length > 1 && !searchStopWords.has(term));
  const effectiveTerms = terms.length ? terms : normalizedQuery.split(/\s+/).filter(Boolean);

  return deck.slides
    .map((slide, index) => {
      const title = slide.title.toLowerCase();
      const summary = slide.summary.toLowerCase();
      const bullets = slide.bullets.join(" ").toLowerCase();
      const exactPhrase = normalizedQuery.length > 2
        && `${title} ${summary} ${bullets}`.includes(normalizedQuery);
      const score = effectiveTerms.reduce((total, term) => (
        total
        + (title.includes(term) ? 5 : 0)
        + (summary.includes(term) ? 3 : 0)
        + (bullets.includes(term) ? 2 : 0)
      ), exactPhrase ? 8 : 0);
      return {
        index,
        slideNumber: slide.slideNumber,
        title: slide.title,
        summary: slide.summary,
        score,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(5, limit)));
}

/** Resolve the model's zero-based tool index against the learner-facing page number. */
export function resolveSlideIndex(deck: LectureDeck, requestedIndex: number, learnerText = "") {
  const bounded = Math.max(0, Math.min(deck.slides.length - 1, requestedIndex));
  const match = learnerText.match(/\b(?:page|slide)(?:\s+number)?\s*#?\s*(\d+)\b/i);
  if (!match) return bounded;
  const visiblePage = Number(match[1]);
  if (!Number.isSafeInteger(visiblePage)) return bounded;
  const visibleIndex = deck.slides.findIndex((slide) => slide.slideNumber === visiblePage);
  return visibleIndex >= 0 ? visibleIndex : bounded;
}

export function boardContextForPrompt(board?: TutorBoardContext) {
  if (!board) return "No whiteboard context is available.";
  return JSON.stringify({
    version: board.version,
    shapes: board.shapes.slice(0, 120),
    diff: board.diff ? {
      version: board.diff.version,
      reset: board.diff.reset,
      created: board.diff.created.slice(0, 60),
      updated: board.diff.updated.slice(0, 60),
      deleted: board.diff.deleted.slice(0, 60),
    } : undefined,
    imageIncluded: Boolean(board.imageDataUrl),
  }).slice(0, 120_000);
}

export function toCanvasActions(value: unknown): WhiteboardCanvasAction[] {
  const parsed = z.array(boardOperationSchema).max(12).safeParse(value);
  return parsed.success ? parsed.data as WhiteboardCanvasAction[] : [];
}
