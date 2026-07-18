import { describe, expect, it } from "vitest";

import { CuePerformance } from "./notebook-probe-cue-performance";

describe("CuePerformance", () => {
  const plan = { id: "plan-a", beats: [{ id: "first", value: 1 }, { id: "second", value: 2 }] };

  it("accepts each cue once and makes retries idempotent", () => {
    const performance = new CuePerformance<{ id: string; value: number }>();
    expect(performance.begin(plan)).toBe(true);
    expect(performance.claim("plan-a", "first")).toEqual({ kind: "accepted", beat: plan.beats[0] });
    expect(performance.claim("plan-a", "first")).toEqual({ kind: "duplicate" });
  });

  it("rejects stale plan ids and unknown beats", () => {
    const performance = new CuePerformance<{ id: string; value: number }>();
    performance.begin(plan);
    expect(performance.claim("old-plan", "first")).toEqual({ kind: "stale" });
    expect(performance.claim("plan-a", "missing")).toEqual({ kind: "unknown" });
  });

  it("invalidates old cues when a performance is replaced or cancelled", () => {
    const performance = new CuePerformance<{ id: string; value: number }>();
    performance.begin(plan);
    performance.begin({ id: "plan-b", beats: [{ id: "only", value: 3 }] });
    expect(performance.claim("plan-a", "second")).toEqual({ kind: "stale" });
    expect(performance.cancel("plan-b")).toBe(true);
    expect(performance.claim("plan-b", "only")).toEqual({ kind: "stale" });
  });

  it("refuses plans with duplicate beat ids", () => {
    const performance = new CuePerformance<{ id: string }>();
    expect(performance.begin({ id: "bad", beats: [{ id: "duplicate" }, { id: "duplicate" }] })).toBe(false);
    expect(performance.activePlanId).toBeUndefined();
  });
});
