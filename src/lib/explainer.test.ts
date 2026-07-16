import { describe, expect, it } from "vitest";

import {
  buildExplainerSpec,
  buildExplainerPreviewHtml,
  chooseExplainerEngine,
  jobKeyForSpec,
  normalizeExplainerInput,
} from "@/lib/explainer";

describe("visual explainer planning", () => {
  it("routes mathematical questions to Manim and preserves the allowed duration", () => {
    expect(chooseExplainerEngine({ question: "Why does the chain rule work?", concept: "derivative", goal: "show the transformation" })).toBe("manim");
    expect(normalizeExplainerInput({ question: " q ", concept: " chain rule ", goal: " g ", durationSec: 42 }).durationSec).toBe(15);
  });

  it("routes conceptual questions to HyperFrames and hashes equivalent specs deterministically", () => {
    const input = { question: "Why does feedback help memory?", concept: "active recall", goal: "show the loop", durationSec: 30 as const };
    const first = buildExplainerSpec(input);
    const second = buildExplainerSpec(input);
    expect(first.engine).toBe("hyperframes");
    expect(jobKeyForSpec(first)).toBe(jobKeyForSpec(second));
    expect(first.beats).toHaveLength(3);
    expect(first.beats.at(-1)?.startSec).toBe(20);
  });

  it("emits a deterministic HyperFrames composition contract", () => {
    const html = buildExplainerPreviewHtml(buildExplainerSpec({
      question: "How does feedback work?",
      concept: "active recall",
      goal: "show the loop",
      durationSec: 15,
    }));
    expect(html).toContain('data-composition-id="studydeck-explainer"');
    expect(html).toContain('class="beat clip"');
    expect(html).toContain('window.__timelines["studydeck-explainer"]');
    expect(html).toContain("height:116px;max-height:116px");
    expect(html).not.toContain("Math.random");
  });
});
