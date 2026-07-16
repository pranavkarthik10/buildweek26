import { describe, expect, it } from "vitest";

import { parsePersistedLectureDeck } from "@/lib/persisted-deck";

const slide = {
  id: "one", slideNumber: 1, imageUrl: "/one.png", title: "Counts",
  summary: "Verify records", bullets: ["Find shrinkage"], coachNote: "", examRelevance: "high", cues: [],
};

describe("persisted lecture decks", () => {
  it("loads the production slides-array format", () => {
    const deck = parsePersistedLectureDeck({
      id: "deck", title: "Inventory", courseName: "Operations", summary: "Controls",
      studyStrategy: "Practice", totalSlides: 1, slides: JSON.stringify([slide]),
    });
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0]?.title).toBe("Counts");
    expect(deck.summary).toBe("Controls");
  });

  it("remains compatible with early full-deck records", () => {
    const deck = parsePersistedLectureDeck({
      id: "deck", title: "Fallback", slides: JSON.stringify({ deckTitle: "Stored title", slides: [slide] }),
    });
    expect(deck.deckTitle).toBe("Stored title");
    expect(deck.totalSlides).toBe(1);
  });
});
