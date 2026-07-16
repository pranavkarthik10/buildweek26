import { z } from "zod";

import type { VisualExplainerSpec } from "@/lib/explainer-types";

const expression: z.ZodType = z.lazy(() => z.union([
  z.object({ type: z.literal("constant"), value: z.number().finite() }).strict(),
  z.object({ type: z.literal("variable"), name: z.enum(["x", "y", "t"]) }).strict(),
  z.object({
    type: z.enum(["add", "subtract", "multiply", "divide"]),
    left: expression,
    right: expression,
  }).strict(),
  z.object({ type: z.literal("power"), base: expression, exponent: z.number().finite().min(-8).max(8) }).strict(),
  z.object({ type: z.enum(["sin", "cos", "tan", "exp", "log", "sqrt"]), value: expression }).strict(),
]));

const captions = z.array(z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/).max(48),
  text: z.string().trim().min(1).max(600),
  startSec: z.number().finite().min(0).max(45),
  durationSec: z.number().finite().positive().max(45),
}).strict()).min(1).max(8);

const diagram = z.object({
  engine: z.literal("diagram"),
  nodes: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/).max(48),
    label: z.string().trim().min(1).max(180),
    value: z.string().trim().max(120).optional(),
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    tone: z.enum(["accent", "secondary", "muted", "warning"]).optional(),
  }).strict()).min(1).max(16),
  edges: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/).max(48),
    from: z.string().regex(/^[a-z0-9_-]+$/).max(48),
    to: z.string().regex(/^[a-z0-9_-]+$/).max(48),
    label: z.string().trim().max(120).optional(),
  }).strict()).max(24),
  steps: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/).max(48),
    title: z.string().trim().min(1).max(120),
    narration: z.string().trim().min(1).max(600),
    nodeIds: z.array(z.string()).max(16).optional(),
    edgeIds: z.array(z.string()).max(24).optional(),
    startSec: z.number().finite().min(0).max(45),
    durationSec: z.number().finite().positive().max(45),
  }).strict()).min(1).max(8),
}).strict();

const jsxgraph = z.object({
  engine: z.literal("jsxgraph"),
  viewport: z.object({
    xMin: z.number().finite().min(-1000).max(1000),
    xMax: z.number().finite().min(-1000).max(1000),
    yMin: z.number().finite().min(-1000).max(1000),
    yMax: z.number().finite().min(-1000).max(1000),
  }).strict(),
  objects: z.array(z.union([
    z.object({ type: z.literal("point"), id: z.string().max(48), x: z.number().finite(), y: z.number().finite(), label: z.string().max(120).optional() }).strict(),
    z.object({ type: z.literal("segment"), id: z.string().max(48), from: z.tuple([z.number().finite(), z.number().finite()]), to: z.tuple([z.number().finite(), z.number().finite()]), label: z.string().max(120).optional() }).strict(),
    z.object({ type: z.literal("circle"), id: z.string().max(48), center: z.tuple([z.number().finite(), z.number().finite()]), radius: z.number().finite().positive().max(1000), label: z.string().max(120).optional() }).strict(),
    z.object({ type: z.literal("function"), id: z.string().max(48), expression, domain: z.tuple([z.number().finite(), z.number().finite()]), label: z.string().max(120).optional() }).strict(),
    z.object({ type: z.literal("slider"), id: z.string().max(48), min: z.number().finite(), max: z.number().finite(), value: z.number().finite(), label: z.string().trim().min(1).max(80) }).strict(),
  ])).min(1).max(24),
}).strict();

const plotly = z.object({
  engine: z.literal("plotly"),
  chartType: z.enum(["line", "bar", "scatter"]),
  x: z.array(z.union([z.string().max(80), z.number().finite()])).min(1).max(200),
  series: z.array(z.object({ name: z.string().trim().min(1).max(100), values: z.array(z.number().finite()).max(200), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }).strict()).min(1).max(8),
  frames: z.array(z.object({ name: z.string().max(80), series: z.array(z.array(z.number().finite()).max(200)).max(8) }).strict()).max(24).optional(),
  xLabel: z.string().max(100).optional(),
  yLabel: z.string().max(100).optional(),
}).strict();

const manim = z.object({
  engine: z.literal("manim"),
  objects: z.array(z.union([
    z.object({ type: z.literal("text"), id: z.string().max(48), text: z.string().trim().min(1).max(300), x: z.number().finite().min(-7).max(7).optional(), y: z.number().finite().min(-4).max(4).optional() }).strict(),
    z.object({ type: z.literal("formula"), id: z.string().max(48), latex: z.string().trim().min(1).max(300).refine((value) => !/\\(?:input|include|write18|openout|catcode|href|url)\b/i.test(value), "Unsafe LaTeX command").refine((value) => !/[{}]{3,}/.test(value), "Malformed LaTeX nesting"), x: z.number().finite().min(-7).max(7).optional(), y: z.number().finite().min(-4).max(4).optional() }).strict(),
    z.object({ type: z.literal("circle"), id: z.string().max(48), x: z.number().finite().min(-7).max(7), y: z.number().finite().min(-4).max(4), radius: z.number().finite().positive().max(4) }).strict(),
    z.object({ type: z.enum(["line", "arrow"]), id: z.string().max(48), from: z.tuple([z.number().finite(), z.number().finite()]), to: z.tuple([z.number().finite(), z.number().finite()]) }).strict(),
    z.object({ type: z.literal("axes"), id: z.string().max(48), xRange: z.tuple([z.number().finite(), z.number().finite()]), yRange: z.tuple([z.number().finite(), z.number().finite()]) }).strict(),
    z.object({ type: z.literal("graph"), id: z.string().max(48), expression, domain: z.tuple([z.number().finite(), z.number().finite()]) }).strict(),
  ])).min(1).max(24),
  actions: z.array(z.union([
    z.object({ type: z.enum(["write", "create", "fadeIn", "fadeOut"]), targetId: z.string().max(48), durationSec: z.number().finite().positive().max(10) }).strict(),
    z.object({ type: z.literal("transform"), fromId: z.string().max(48), toId: z.string().max(48), durationSec: z.number().finite().positive().max(10) }).strict(),
    z.object({ type: z.literal("highlight"), targetId: z.string().max(48), durationSec: z.number().finite().positive().max(10) }).strict(),
  ])).min(1).max(48),
}).strict();

export const visualSpecSchema = z.object({
  version: z.literal(2),
  kind: z.enum(["interactive", "video"]),
  engine: z.enum(["diagram", "jsxgraph", "plotly", "manim"]),
  style: z.enum(["clean", "chalk", "math", "diagram"]),
  title: z.string().trim().min(1).max(180),
  question: z.string().trim().min(1).max(500),
  concept: z.string().trim().min(1).max(180),
  goal: z.string().trim().min(1).max(400),
  durationSec: z.union([z.literal(15), z.literal(30), z.literal(45)]),
  aspectRatio: z.literal("16:9"),
  captions,
  citations: z.array(z.object({ label: z.string().trim().min(1).max(180), slideNumber: z.number().int().positive().optional() }).strict()).max(8),
  visual: z.union([diagram, jsxgraph, plotly, manim]),
  audioUrl: z.string().url().max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.engine !== value.visual.engine) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "engine must match visual.engine", path: ["visual", "engine"] });
  if (value.kind !== (value.engine === "manim" ? "video" : "interactive")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only Manim produces video artifacts.", path: ["kind"] });
});

export function validateVisualSpec(input: unknown): VisualExplainerSpec {
  const parsed = visualSpecSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid visual specification: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data as VisualExplainerSpec;
}
