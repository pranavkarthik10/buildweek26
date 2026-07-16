import { describe, expect, it } from "vitest";

import { buildExplainerSpec, chooseExplainerEngine, jobKeyForSpec, normalizeExplainerInput } from "@/lib/explainer";
import { validateVisualSpec } from "@/lib/visual-spec";

describe("visual explainer planning", () => {
  it("routes math, charts, geometry, and concepts to the matching engine", () => {
    expect(chooseExplainerEngine({ question: "Why does the chain rule work?", concept: "derivative", goal: "show the transformation" })).toBe("manim");
    expect(chooseExplainerEngine({ question: "plot inventory turnover", concept: "inventory", goal: "compare years" })).toBe("plotly");
    expect(chooseExplainerEngine({ question: "show a manipulable circle", concept: "geometry", goal: "explore the radius" })).toBe("jsxgraph");
    expect(chooseExplainerEngine({ question: "show the process", concept: "feedback", goal: "explain the loop" })).toBe("diagram");
  });

  it("normalizes duration and produces a validated deterministic spec", () => {
    expect(normalizeExplainerInput({ question: " q ", concept: " chain rule ", goal: " g ", durationSec: 42 }).durationSec).toBe(15);
    const first = buildExplainerSpec({ question: "How does feedback work?", concept: "active recall", goal: "show the loop", durationSec: 30 });
    const second = buildExplainerSpec({ question: "How does feedback work?", concept: "active recall", goal: "show the loop", durationSec: 30 });
    expect(first.engine).toBe("diagram");
    expect(first.kind).toBe("interactive");
    expect(validateVisualSpec(first).version).toBe(2);
    expect(jobKeyForSpec(first)).toBe(jobKeyForSpec(second));
  });

  it("rejects raw code and unknown visual fields", () => {
    const spec = buildExplainerSpec({ question: "animate the chain rule", concept: "chain rule", goal: "show the transformation", durationSec: 15 });
    expect(() => validateVisualSpec({ ...spec, visual: { ...spec.visual, code: "rm -rf /" } })).toThrow();
  });
});
