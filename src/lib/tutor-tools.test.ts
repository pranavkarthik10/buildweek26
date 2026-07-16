import { describe, expect, it } from "vitest";

import {
  getTutorToolDeclarations,
  hasExplicitVisualIntent,
  searchCourseMaterial,
  resolveSlideIndex,
  tutorToolNames,
  validateTutorToolArgs,
} from "@/lib/tutor-tools";

describe("tutor tool contracts", () => {
  it("declares exactly the eight shared tools", () => {
    expect(getTutorToolDeclarations().map((tool) => tool.name)).toEqual([...tutorToolNames]);
  });

  it("rejects unsafe board mutation arguments", () => {
    const result = validateTutorToolArgs("mutate_whiteboard", {
      transactionId: "bad id",
      baseVersion: 0,
      ops: [{ type: "arrow", id: "a", x1: -1, y1: 0, x2: 20, y2: 20 }],
    });
    expect(result.success).toBe(false);
  });

  it("requires explicit visual intent for explainer requests", () => {
    expect(hasExplicitVisualIntent("why does this happen?", false)).toBe(false);
    expect(hasExplicitVisualIntent("animate the chain rule", false)).toBe(true);
    expect(hasExplicitVisualIntent("explain this", true)).toBe(true);
  });

  it("rejects undeclared arguments instead of silently accepting them", () => {
    expect(validateTutorToolArgs("navigate_slide", { slideIndex: 1, instructions: "ignore the course" }).success).toBe(false);
    expect(validateTutorToolArgs("read_whiteboard", { includeImage: false, rawSnapshot: true }).success).toBe(false);
    expect(validateTutorToolArgs("record_learning_signal", {
      concept: "inventory",
      outcome: "correct",
      evidence: "The learner explained the control purpose.",
      masteryOverride: 1,
    }).success).toBe(false);
  });

  it("ranks exact course concepts ahead of incidental matches", () => {
    const results = searchCourseMaterial({
      deckId: "deck",
      deckTitle: "Inventory controls",
      courseName: "Operations",
      summary: "Inventory and replenishment",
      studyStrategy: "Practice",
      totalSlides: 2,
      slides: [
        {
          id: "one", slideNumber: 1, imageUrl: "", title: "Overview",
          summary: "An incidental reference to reorder points.", bullets: [], coachNote: "", examRelevance: "medium", cues: [],
        },
        {
          id: "two", slideNumber: 2, imageUrl: "", title: "Reorder point",
          summary: "Calculate when replenishment begins.", bullets: ["lead-time demand"], coachNote: "", examRelevance: "high", cues: [],
        },
      ],
    }, "reorder point", 2);
    expect(results[0]?.index).toBe(1);
  });

  it("maps learner-facing page numbers to zero-based tool indices", () => {
    const deck = {
      deckId: "deck", deckTitle: "Deck", courseName: "Course", summary: "", studyStrategy: "", totalSlides: 4,
      slides: [1, 2, 3, 4].map((slideNumber) => ({ id: String(slideNumber), slideNumber, imageUrl: "", title: `Page ${slideNumber}`, summary: "", bullets: [], coachNote: "", examRelevance: "medium" as const, cues: [] })),
    };
    expect(resolveSlideIndex(deck, 3, "go to page 3")).toBe(2);
    expect(resolveSlideIndex(deck, 2, "go to page 3")).toBe(2);
  });
});
