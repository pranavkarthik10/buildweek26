import { describe, expect, it } from "vitest";

import {
  buildRealtimeTutorInstructions,
  latestRealtimeUserTranscript,
  realtimeMessageTranscript,
} from "@/lib/realtime-tutor-context";
import type { LectureDeck } from "@/lib/aiprof-types";

const deck: LectureDeck = {
  deckId: "deck",
  deckTitle: "Inventory",
  courseName: "Operations",
  summary: "Inventory controls",
  studyStrategy: "Connect controls to evidence.",
  totalSlides: 2,
  slides: [
    { id: "one", slideNumber: 1, imageUrl: "", title: "Counts", summary: "Physical counts", bullets: ["verify records"], coachNote: "", examRelevance: "high", cues: [] },
    { id: "two", slideNumber: 2, imageUrl: "", title: "Reorder point", summary: "Replenishment timing", bullets: ["lead time"], coachNote: "", examRelevance: "high", cues: [] },
  ],
};

describe("realtime tutor context", () => {
  it("refreshes the canonical slide context after navigation", () => {
    const instructions = buildRealtimeTutorInstructions({
      deck,
      currentSlideIndex: 1,
      teachingFormat: "guided",
      customInstructions: "Use examples.",
    });
    expect(instructions).toContain("Current slide index: 1");
    expect(instructions).toContain("Reorder point");
    expect(instructions).not.toContain("Current slide 1: Counts");
  });

  it("persists only completed transcript items", () => {
    expect(realtimeMessageTranscript({
      itemId: "partial", type: "message", role: "user", status: "in_progress",
      content: [{ transcript: "wait" }],
    })).toBeNull();
    expect(realtimeMessageTranscript({
      itemId: "done", type: "message", role: "user", status: "completed",
      content: [{ transcript: "wait, why?" }],
    })).toEqual({ itemId: "done", role: "user", transcript: "wait, why?" });
  });

  it("finds the latest completed learner request for intent checks", () => {
    expect(latestRealtimeUserTranscript([
      { itemId: "one", type: "message", role: "user", status: "completed", content: [{ transcript: "explain it" }] },
      { itemId: "two", type: "message", role: "assistant", status: "completed", content: [{ transcript: "Sure" }] },
      { itemId: "three", type: "message", role: "user", status: "completed", content: [{ transcript: "animate it" }] },
    ])).toBe("animate it");
  });
});
