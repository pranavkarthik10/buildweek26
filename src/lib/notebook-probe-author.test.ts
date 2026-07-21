import { describe, expect, it } from "vitest";

import {
  notebookProbeAuthorRequestSchema,
  notebookProbeInkPlanSchema,
  validateInkPlanRegions,
} from "@/lib/notebook-probe-author";

const region = {
  id: "mitochondrion-1",
  label: "mitochondrion",
  kind: "diagram" as const,
  confidence: 0.94,
  box: { x: 0.12, y: 0.22, width: 0.18, height: 0.11 },
};

describe("notebook probe author schemas", () => {
  it("bounds a complete realtime solution to eight beats", () => {
    const result = notebookProbeInkPlanSchema.safeParse({
      summary: "Short slice",
      narrationBrief: "Only the next useful move.",
      beats: Array.from({ length: 9 }, (_, index) => ({
        id: `step-${index}`,
        atMs: index * 300,
        durationMs: 300,
        voiceCue: "Start here.",
        action: { type: "circle" as const, targetRegionId: region.id, color: "blue" as const },
      })),
    });

    expect(result.success).toBe(false);
  });

  it("accepts a bounded author request", () => {
    const result = notebookProbeAuthorRequestSchema.safeParse({
      imageDataUrl: "data:image/png;base64,AAAA",
      question: "What does this do?",
      regions: [region],
      focusedRegionIds: [region.id],
      hasLearnerInk: true,
      intent: "check_work",
    });
    expect(result.success).toBe(true);
  });

  it("accepts underline correction beats", () => {
    const result = notebookProbeInkPlanSchema.safeParse({
      summary: "Mark the arithmetic slip.",
      narrationBrief: "The derivative setup is right, but this multiplication is off.",
      beats: [{
        id: "underline-step",
        atMs: 0,
        durationMs: 500,
        voiceCue: "This step is where the sign flipped.",
        action: { type: "underline", x: 0.2, y: 0.55, width: 0.28, color: "red" },
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts speak-only clarification beats", () => {
    const result = notebookProbeInkPlanSchema.safeParse({
      summary: "Answer aloud",
      narrationBrief: "Explain the quotient without new writing.",
      beats: [{
        id: "speak-1",
        atMs: 0,
        durationMs: 600,
        voiceCue: "We divide because both sides still have that factor.",
        action: { type: "speak" },
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unsupported image URLs", () => {
    const result = notebookProbeAuthorRequestSchema.safeParse({
      imageDataUrl: "https://example.com/cell.png",
      question: "Label this",
      regions: [],
    });
    expect(result.success).toBe(false);
  });

  it("detects model-authored references to unknown regions", () => {
    const plan = notebookProbeInkPlanSchema.parse({
      summary: "Point out the nucleus.",
      narrationBrief: "This structure stores the cell's genetic material.",
      beats: [{
        id: "circle-nucleus",
        atMs: 0,
        durationMs: 700,
        voiceCue: "This is the nucleus.",
        action: { type: "circle", targetRegionId: "missing", color: "violet" },
      }],
    });
    expect(validateInkPlanRegions(plan, [region])).toEqual(["missing"]);
  });

  it("rejects duplicate or out-of-order realtime beat cues", () => {
    const result = notebookProbeInkPlanSchema.safeParse({
      summary: "Explain two structures.",
      narrationBrief: "First one, then the other.",
      beats: [
        { id: "same", atMs: 500, durationMs: 300, voiceCue: "First", action: { type: "circle", targetRegionId: region.id, color: "violet" } },
        { id: "same", atMs: 100, durationMs: 300, voiceCue: "Second", action: { type: "label", targetRegionId: region.id, text: "Second", placement: "east", color: "violet" } },
      ],
    });
    expect(result.success).toBe(false);
  });
});
