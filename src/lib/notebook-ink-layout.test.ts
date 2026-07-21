import { describe, expect, it } from "vitest";

import type { TutorInkPlan } from "@/components/notebook-probe/probe-types";
import {
  describeTutorInkHistory,
  placeContinuationBelowExistingInk,
  sanitizeTutorInkPlan,
  sanitizeTutorVoiceCue,
} from "@/lib/notebook-ink-layout";

function plan(id: string, writes: Array<{ text: string; x: number; y: number }>): TutorInkPlan {
  return {
    id,
    summary: id,
    narrationBrief: id,
    beats: writes.map((write, index) => ({
      id: `${id}-${index}`,
      atMs: index * 300,
      durationMs: 300,
      voiceCue: write.text,
      action: { type: "write", color: "blue", ...write },
    })),
  };
}

describe("incremental notebook ink layout", () => {
  it("places every continuation line below the previous visible line", () => {
    const history = [plan("first", [
      { text: "u=x^2", x: 0.12, y: 0.68 },
      { text: "u'=2x", x: 0.12, y: 0.755 },
    ])];
    const continuation = placeContinuationBelowExistingInk(plan("next", [
      { text: "bad model position", x: 0.5, y: 0.2 },
      { text: "another line", x: 0.2, y: 0.1 },
    ]), history);
    const writes = continuation.beats.map((beat) => beat.action).filter((action) => action.type === "write");

    expect(writes.map(({ x }) => x)).toEqual([0.12, 0.12]);
    expect(writes[0]?.y).toBeCloseTo(0.83);
    expect(writes[1]?.y).toBeCloseTo(0.905);
    expect(describeTutorInkHistory(history)).toContain('"u\'=2x" at x=0.120, y=0.755');
  });

  it("normalizes line order inside the first authored solution", () => {
    const normalized = placeContinuationBelowExistingInk(plan("first", [
      { text: "line one", x: 0.2, y: 0.7 },
      { text: "misplaced line", x: 0.6, y: 0.3 },
    ]), []);
    const writes = normalized.beats.map((beat) => beat.action).filter((action) => action.type === "write");

    expect(writes[0]).toMatchObject({ x: 0.2, y: 0.7 });
    expect(writes[1]?.x).toBe(0.2);
    expect(writes[1]?.y).toBeCloseTo(0.775);
  });

  it("strips plan/client implementation chatter from spoken cues", () => {
    expect(sanitizeTutorVoiceCue("I'll wait for the client plan.")).toBe("Watch this next step.");
    expect(sanitizeTutorVoiceCue("Differentiate both sides. Next beat uses the product rule.")).toBe(
      "Differentiate both sides.",
    );
    const cleaned = sanitizeTutorInkPlan(plan("leaky", [
      { text: "Waiting for the ink plan from the client tool.", x: 0.1, y: 0.7 },
    ]));
    expect(cleaned.beats[0]?.voiceCue).toBe("Watch this next step.");
  });
});
