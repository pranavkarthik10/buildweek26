import { describe, expect, it } from "vitest";

import {
  buildRealtimePerformanceInstructions,
  compactTutorInkPlanForRealtime,
  isContinueRequest,
  isLearnerTakingATurn,
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

  it("requires finishing every beat in one turn and handoff on learner turn", () => {
    const instructions = buildRealtimePerformanceInstructions("Base rules");

    expect(instructions).toContain("perform every beat");
    expect(instructions).toContain("nextBeatId until isFinal");
    expect(instructions).toContain("status handoff");
    expect(instructions).toContain("request_ink_plan");
  });

  it("detects continue vs learner-taking-a-turn phrasing", () => {
    expect(isContinueRequest("continue")).toBe(true);
    expect(isContinueRequest("next step")).toBe(true);
    expect(isContinueRequest("keep going")).toBe(true);
    expect(isLearnerTakingATurn("I'll try the next one")).toBe(true);
    expect(isLearnerTakingATurn("let me try g")).toBe(true);
    expect(isLearnerTakingATurn("my turn")).toBe(true);
    expect(isContinueRequest("I'll try the next")).toBe(false);
    expect(isLearnerTakingATurn("check my work")).toBe(false);
  });
});
