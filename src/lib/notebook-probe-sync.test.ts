import { describe, expect, it, vi } from "vitest";

import { InkPlanScheduler, type InkPlan } from "@/lib/notebook-probe-sync";

const plan: InkPlan<string> = {
  id: "plan-1",
  beats: [
    { id: "circle", atMs: 0, durationMs: 100, payload: "circle", voiceCue: "Look here" },
    { id: "arrow", atMs: 100, durationMs: 50, payload: "arrow" },
  ],
};

describe("InkPlanScheduler", () => {
  it("dispatches same-time starts before ends in a deterministic authored order", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const scheduler = new InkPlanScheduler<string>({
      onStart: () => events.push("plan:start"),
      onBeatStart: ({ beat }) => events.push(`${beat.id}:start`),
      onBeatEnd: ({ beat }) => events.push(`${beat.id}:end`),
      onComplete: () => events.push("plan:complete"),
    });

    scheduler.start(plan);
    expect(events).toEqual(["plan:start", "circle:start"]);
    vi.advanceTimersByTime(100);
    expect(events).toEqual(["plan:start", "circle:start", "arrow:start", "circle:end"]);
    vi.advanceTimersByTime(50);
    expect(events).toEqual(["plan:start", "circle:start", "arrow:start", "circle:end", "arrow:end", "plan:complete"]);
    vi.useRealTimers();
  });

  it("freezes elapsed time while paused and resumes the remaining timeline", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const scheduler = new InkPlanScheduler<string>({
      onBeatStart: ({ beat }) => events.push(`${beat.id}:start`),
      onBeatEnd: ({ beat }) => events.push(`${beat.id}:end`),
    });
    scheduler.start(plan);
    vi.advanceTimersByTime(40);
    expect(scheduler.pause("plan-1")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(events).toEqual(["circle:start"]);
    expect(scheduler.resume("plan-1")).toBe(true);
    vi.advanceTimersByTime(60);
    expect(events).toEqual(["circle:start", "arrow:start", "circle:end"]);
    vi.advanceTimersByTime(50);
    expect(events).toEqual(["circle:start", "arrow:start", "circle:end", "arrow:end"]);
    vi.useRealTimers();
  });

  it("cancels old work when replaced and rejects stale plan controls", () => {
    vi.useFakeTimers();
    const cancelled: string[] = [];
    const events: string[] = [];
    const scheduler = new InkPlanScheduler<string>({
      onCancel: (id, _elapsed, reason) => cancelled.push(`${id}:${reason}`),
      onBeatStart: ({ planId, beat }) => events.push(`${planId}:${beat.id}`),
    });
    scheduler.start(plan);
    scheduler.start({ id: "plan-2", beats: [{ id: "label", atMs: 20, durationMs: 10, payload: "label" }] });
    expect(cancelled).toEqual(["plan-1:replaced"]);
    expect(scheduler.cancel("plan-1")).toBe(false);
    expect(scheduler.seek("plan-1", 0)).toBe(false);
    vi.advanceTimersByTime(20);
    expect(events).toEqual(["plan-1:circle", "plan-2:label"]);
    vi.useRealTimers();
  });

  it("seeks by emitting a renderer reconciliation snapshot instead of replaying old beats", () => {
    vi.useFakeTimers();
    const starts: string[] = [];
    const seeks: Array<{ elapsedMs: number; active: string[] }> = [];
    const scheduler = new InkPlanScheduler<string>({
      onBeatStart: ({ beat }) => starts.push(beat.id),
      onSeek: ({ elapsedMs, activeBeats }) => seeks.push({ elapsedMs, active: activeBeats.map((beat) => beat.id) }),
    });
    scheduler.start(plan);
    expect(scheduler.seek("plan-1", 125)).toBe(true);
    expect(seeks).toEqual([{ elapsedMs: 125, active: ["arrow"] }]);
    expect(starts).toEqual(["circle"]);
    vi.advanceTimersByTime(25);
    expect(scheduler.getStatus("plan-1")).toBe("completed");
    vi.useRealTimers();
  });

  it("supports a backward seek by rebuilding the authored timeline", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const scheduler = new InkPlanScheduler<string>({ onBeatStart: ({ beat }) => events.push(beat.id) });
    scheduler.start(plan);
    scheduler.seek("plan-1", 125);
    scheduler.seek("plan-1", 50);
    vi.advanceTimersByTime(50);
    expect(events).toEqual(["circle", "arrow"]);
    vi.useRealTimers();
  });

  it("rejects malformed timings and duplicate beat ids", () => {
    const scheduler = new InkPlanScheduler();
    expect(() => scheduler.start({ id: "bad", beats: [{ id: "x", atMs: -1, durationMs: 0, payload: null }] })).toThrow("timings");
    expect(() => scheduler.start({ id: "bad", beats: [{ id: "x", atMs: 0, durationMs: 0, payload: null }, { id: "x", atMs: 1, durationMs: 0, payload: null }] })).toThrow("unique");
  });
});
