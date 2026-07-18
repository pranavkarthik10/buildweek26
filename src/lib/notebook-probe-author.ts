import { z } from "zod";

const normalized = z.number().finite().min(0).max(1);
const notebookCoordinate = z.number().finite().min(-0.25).max(1.55);

export const notebookProbeRegionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(["diagram", "text", "formula", "table", "image", "other"]),
  confidence: normalized,
  box: z.object({
    x: normalized,
    y: normalized,
    width: normalized,
    height: normalized,
  }).strict(),
}).strict().superRefine((region, context) => {
  if (region.box.x + region.box.width > 1) {
    context.addIssue({ code: "custom", path: ["box", "width"], message: "box must fit within the image" });
  }
  if (region.box.y + region.box.height > 1) {
    context.addIssue({ code: "custom", path: ["box", "height"], message: "box must fit within the image" });
  }
});

export const notebookProbeAuthorRequestSchema = z.object({
  imageDataUrl: z.string().max(6_500_000),
  question: z.string().trim().min(1).max(800),
  regions: z.array(notebookProbeRegionSchema).max(40),
  focusedRegionIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  existingInkSummary: z.string().trim().max(2_000).optional(),
}).strict().superRefine((value, context) => {
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value.imageDataUrl)) {
    context.addIssue({
      code: "custom",
      path: ["imageDataUrl"],
      message: "imageDataUrl must be a PNG, JPEG, or WebP base64 data URL.",
    });
  }
});

const inkColorSchema = z.enum(["violet", "red", "blue", "green", "orange"]);
const placementSchema = z.enum(["north", "east", "south", "west"]);

const circleActionSchema = z.object({
  type: z.literal("circle"),
  targetRegionId: z.string().trim().min(1).max(80),
  color: inkColorSchema,
}).strict();

const arrowActionSchema = z.object({
  type: z.literal("arrow"),
  targetRegionId: z.string().trim().min(1).max(80),
  placement: placementSchema,
  color: inkColorSchema,
}).strict();

const labelActionSchema = z.object({
  type: z.literal("label"),
  targetRegionId: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(120),
  placement: placementSchema,
  color: inkColorSchema,
}).strict();

const writeActionSchema = z.object({
  type: z.literal("write"),
  text: z.string().trim().min(1).max(280),
  x: notebookCoordinate,
  y: notebookCoordinate,
  color: inkColorSchema,
}).strict();

export const notebookProbeInkActionSchema = z.discriminatedUnion("type", [
  circleActionSchema,
  arrowActionSchema,
  labelActionSchema,
  writeActionSchema,
]);

export const notebookProbeInkPlanSchema = z.object({
  summary: z.string().trim().min(1).max(240),
  narrationBrief: z.string().trim().min(1).max(1_200),
  beats: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    atMs: z.number().int().min(0).max(30_000),
    durationMs: z.number().int().min(120).max(8_000),
    voiceCue: z.string().trim().min(1).max(240),
    action: notebookProbeInkActionSchema,
  }).strict()).min(1).max(12),
}).strict().superRefine((plan, context) => {
  const beatIds = new Set<string>();
  for (const [index, beat] of plan.beats.entries()) {
    if (beatIds.has(beat.id)) context.addIssue({ code: "custom", path: ["beats", index, "id"], message: "beat ids must be unique" });
    beatIds.add(beat.id);
    if (index > 0 && beat.atMs < plan.beats[index - 1].atMs) {
      context.addIssue({ code: "custom", path: ["beats", index, "atMs"], message: "beats must be in ascending order" });
    }
  }
});

export type NotebookProbeRegion = z.infer<typeof notebookProbeRegionSchema>;
export type NotebookProbeAuthorRequest = z.infer<typeof notebookProbeAuthorRequestSchema>;
export type NotebookProbeInkAction = z.infer<typeof notebookProbeInkActionSchema>;
export type NotebookProbeInkPlan = z.infer<typeof notebookProbeInkPlanSchema>;

export function validateInkPlanRegions(plan: NotebookProbeInkPlan, regions: NotebookProbeRegion[]) {
  const regionIds = new Set(regions.map((region) => region.id));
  const unknown = plan.beats.flatMap((beat) => {
    const action = beat.action;
    return "targetRegionId" in action && !regionIds.has(action.targetRegionId)
      ? [action.targetRegionId]
      : [];
  });
  return [...new Set(unknown)];
}
