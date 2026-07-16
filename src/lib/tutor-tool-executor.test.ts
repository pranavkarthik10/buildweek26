import { describe, expect, it } from "vitest";

import { executeTutorTool } from "@/lib/tutor-tool-executor";
import type { TutorContext } from "@/lib/tutor-tools";

const context: TutorContext = {
  deck: {
    deckId: "deck-1",
    deckTitle: "Inventory",
    courseName: "Operations",
    summary: "Inventory controls",
    studyStrategy: "Connect each formula to a decision.",
    totalSlides: 2,
    slides: [
      {
        id: "slide-1",
        slideNumber: 1,
        imageUrl: "",
        title: "Physical counts",
        summary: "Why counts validate records.",
        bullets: ["verify records", "find shrinkage"],
        coachNote: "",
        examRelevance: "high",
        cues: [],
      },
      {
        id: "slide-2",
        slideNumber: 2,
        imageUrl: "",
        title: "Reorder point",
        summary: "When to replenish.",
        bullets: ["lead time"],
        coachNote: "",
        examRelevance: "medium",
        cues: [],
      },
    ],
  },
  currentSlideIndex: 0,
  currentSlide: {} as TutorContext["currentSlide"],
  board: { version: 4, shapes: [] },
};

describe("server tutor tool executor", () => {
  it("searches and navigates within the validated deck", async () => {
    const search = await executeTutorTool("search_course_material", { query: "shrinkage" }, context, "local-user");
    expect(search.output.ok).toBe(true);
    expect((search.output.results as Array<{ slideNumber: number }>)[0]?.slideNumber).toBe(1);

    const navigation = await executeTutorTool("navigate_slide", { slideIndex: 1 }, context, "local-user");
    expect(navigation.effects).toEqual([{ type: "navigate_slide", slideIndex: 1 }]);
  });

  it("returns a validated additive board effect and rejects stale versions", async () => {
    const mutation = await executeTutorTool("mutate_whiteboard", {
      transactionId: "text-fix-1",
      baseVersion: 4,
      ops: [{ type: "arrow", id: "fix", x1: 20, y1: 20, x2: 60, y2: 60 }],
    }, context, "local-user");
    expect(mutation.output.ok).toBe(true);
    expect(mutation.effects[0]?.type).toBe("mutate_whiteboard");

    const stale = await executeTutorTool("mutate_whiteboard", {
      transactionId: "text-fix-2",
      baseVersion: 3,
      ops: [{ type: "arrow", id: "stale", x1: 20, y1: 20, x2: 60, y2: 60 }],
    }, context, "local-user");
    expect(stale.trace.status).toBe("failed");
    expect(stale.output.code).toBe("conflict");
  });

  it("does not let model-authored arguments manufacture learner visual intent", async () => {
    const result = await executeTutorTool("create_micro_explainer", {
      question: "animate this concept",
      concept: "inventory",
      goal: "show the process",
      durationSec: 15,
    }, { ...context, learnerQuestion: "Why does this happen?", visualIntent: false }, "local-user");
    expect(result.trace.status).toBe("failed");
    expect(result.output.error).toContain("explicit learner intent");
  });
});
