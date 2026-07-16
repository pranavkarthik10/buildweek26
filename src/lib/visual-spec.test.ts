import { describe, expect, it } from "vitest";

import { buildExplainerSpec } from "@/lib/explainer";
import { validateVisualSpec } from "@/lib/visual-spec";

describe("visual specification contract", () => {
  it("accepts bounded interactive diagrams and rejects unknown fields", () => {
    const spec = buildExplainerSpec({ question: "show the process", concept: "workflow", goal: "connect the steps", durationSec: 15 });
    expect(validateVisualSpec(spec).engine).toBe("diagram");
    expect(() => validateVisualSpec({ ...spec, visual: { ...spec.visual, script: "alert(1)" } })).toThrow();
  });

  it("keeps math visuals as video artifacts with the allowlisted AST", () => {
    const spec = buildExplainerSpec({ question: "animate the derivative", concept: "calculus", goal: "show the slope", durationSec: 30 });
    expect(spec.kind).toBe("video");
    expect(spec.engine).toBe("manim");
    expect(spec.visual.engine).toBe("manim");
  });

  it("rejects LaTeX file and shell escape commands", () => {
    const spec = buildExplainerSpec({ question: "animate the derivative", concept: "calculus", goal: "show the slope", durationSec: 15 });
    expect(() => validateVisualSpec({ ...spec, visual: { ...spec.visual, objects: [{ type: "formula", id: "bad", latex: "\\input{secret}" }], actions: [{ type: "write", targetId: "bad", durationSec: 1 }] } })).toThrow();
  });
});
