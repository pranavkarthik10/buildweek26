import { describe, expect, it } from "vitest";

import {
  nextMasteryScore,
  nextReviewIntervalSec,
  normalizeConceptKey,
} from "@/lib/learning";

describe("learner memory", () => {
  it("normalizes concept keys for stable upserts", () => {
    expect(normalizeConceptKey("  Chain Rule: Composition! ")).toBe("chain rule composition");
  });

  it("moves mastery in the direction of evidence", () => {
    expect(nextMasteryScore(0.5, "correct")).toBeGreaterThan(0.5);
    expect(nextMasteryScore(0.5, "incorrect")).toBeLessThan(0.5);
  });

  it("shortens review intervals after an error", () => {
    expect(nextReviewIntervalSec(86_400, "incorrect")).toBe(600);
    expect(nextReviewIntervalSec(86_400, "correct")).toBe(207_360);
  });
});
