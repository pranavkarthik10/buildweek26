import { describe, expect, it } from "vitest";

import {
  buildRealtimePerformanceInstructions,
  isContinueRequest,
  isLearnerTakingATurn,
} from "./use-realtime-performance";

describe("realtime performance protocol", () => {
  it("keeps the realtime connection transcription-only", () => {
    const instructions = buildRealtimePerformanceInstructions("Base rules");

    expect(instructions).toContain("transcription-only");
    expect(instructions).toContain("Never create an audio or text response");
    expect(instructions).toContain("Never call tools");
  });

  it("detects continue vs learner-taking-a-turn phrasing", () => {
    expect(isContinueRequest("continue")).toBe(true);
    expect(isContinueRequest("next step")).toBe(true);
    expect(isContinueRequest("keep going")).toBe(true);
    expect(isContinueRequest("yeah")).toBe(false);
    expect(isLearnerTakingATurn("I'll try the next one")).toBe(true);
    expect(isLearnerTakingATurn("let me try g")).toBe(true);
    expect(isLearnerTakingATurn("my turn")).toBe(true);
    expect(isContinueRequest("I'll try the next")).toBe(false);
    expect(isLearnerTakingATurn("check my work")).toBe(false);
  });
});
