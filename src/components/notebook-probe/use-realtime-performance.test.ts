import { describe, expect, it } from "vitest";

import {
  buildRealtimePerformanceInstructions,
  compactTutorInkPlanForRealtime,
} from "./use-realtime-performance";

describe("realtime performance protocol", () => {
  it("removes Terra timing from the voice payload so tool calls remain the clock", () => {
    const compact = compactTutorInkPlanForRealtime({
      id: "plan-1",
      summary: "Find the nucleus",
      narrationBrief: "Start with the nucleus.",
      beats: [{
        id: "nucleus",
        atMs: 250,
        durationMs: 800,
        voiceCue: "This is the nucleus.",
        action: { type: "circle", targetRegionId: "region-1", color: "violet" },
      }],
    });

    expect(compact).toEqual({
      id: "plan-1",
      summary: "Find the nucleus",
      narrationBrief: "Start with the nucleus.",
      beats: [{
        id: "nucleus",
        voiceCue: "This is the nucleus.",
        action: { type: "circle", targetRegionId: "region-1", color: "violet" },
      }],
    });
  });

  it("requires plan creation and a sequential cue tool before narration", () => {
    const instructions = buildRealtimePerformanceInstructions("Base rules");

    expect(instructions).toContain("request_ink_plan first");
    expect(instructions).toContain("Immediately before speaking every beat's voiceCue");
    expect(instructions).toContain("Do not call tools in parallel");
  });
});
