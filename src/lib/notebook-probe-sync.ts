/**
 * A renderer-neutral timeline for coupling an authored ink plan to voice cues.
 * `atMs` is measured from the plan's zero point; it never depends on wall time.
 */
export type InkPlanBeat<TPayload = unknown> = {
  /** Stable within this plan. Useful as a tldraw shape/animation ownership key. */
  id: string;
  /** Offset from the beginning of the plan, in milliseconds. */
  atMs: number;
  /** How long the renderer should keep this beat in its active animation state. */
  durationMs: number;
  /** Opaque renderer command, for example a tldraw operation. */
  payload: TPayload;
  /** Optional narration marker for a Realtime client. */
  voiceCue?: string;
};

export type InkPlan<TPayload = unknown> = {
  /** Must be unique across concurrent/retried authoring requests. */
  id: string;
  beats: readonly InkPlanBeat<TPayload>[];
};

export type InkPlanStatus = "running" | "paused" | "completed" | "cancelled";

export type InkPlanBeatEvent<TPayload> = {
  planId: string;
  beat: InkPlanBeat<TPayload>;
  /** Timeline position, rather than a Date.now() wall-clock timestamp. */
  elapsedMs: number;
};

export type InkPlanSeekEvent<TPayload> = {
  planId: string;
  elapsedMs: number;
  /** Beats whose start has happened but whose end has not happened at this position. */
  activeBeats: readonly InkPlanBeat<TPayload>[];
};

export type InkPlanCallbacks<TPayload> = {
  onStart?: (plan: InkPlan<TPayload>) => void;
  onBeatStart?: (event: InkPlanBeatEvent<TPayload>) => void;
  onBeatEnd?: (event: InkPlanBeatEvent<TPayload>) => void;
  onPause?: (planId: string, elapsedMs: number) => void;
  onResume?: (planId: string, elapsedMs: number) => void;
  /** Reconcile a renderer from this snapshot; seeking intentionally does not replay prior beat callbacks. */
  onSeek?: (event: InkPlanSeekEvent<TPayload>) => void;
  onCancel?: (planId: string, elapsedMs: number, reason: string) => void;
  onComplete?: (planId: string, elapsedMs: number) => void;
};

export type InkPlanSchedulerOptions<TPayload> = InkPlanCallbacks<TPayload> & {
  /** Injected for non-browser runtimes and direct clock tests. Defaults to Date.now. */
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
};

type TimelineEvent<TPayload> = {
  atMs: number;
  order: number;
  kind: "start" | "end";
  beat: InkPlanBeat<TPayload>;
};

type Run<TPayload> = {
  plan: InkPlan<TPayload>;
  allEvents: readonly TimelineEvent<TPayload>[];
  events: TimelineEvent<TPayload>[];
  elapsedMs: number;
  resumedAtMs: number;
  status: InkPlanStatus;
  timer?: ReturnType<typeof setTimeout>;
};

const isNonNegativeSafeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;

/**
 * Schedules only one timer at a time, so equal-time events always dispatch in
 * authored order (starts before ends). All control methods reject stale plan IDs.
 */
export class InkPlanScheduler<TPayload = unknown> {
  private readonly callbacks: InkPlanCallbacks<TPayload>;
  private readonly now: () => number;
  private readonly scheduleTimeout: NonNullable<InkPlanSchedulerOptions<TPayload>["setTimeout"]>;
  private readonly cancelTimeout: NonNullable<InkPlanSchedulerOptions<TPayload>["clearTimeout"]>;
  private run?: Run<TPayload>;

  constructor(options: InkPlanSchedulerOptions<TPayload> = {}) {
    this.callbacks = options;
    this.now = options.now ?? Date.now;
    this.scheduleTimeout = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimeout = options.clearTimeout ?? ((timer) => clearTimeout(timer));
  }

  start(plan: InkPlan<TPayload>): boolean {
    this.validatePlan(plan);
    if (this.run?.status === "running" || this.run?.status === "paused") {
      this.cancel(this.run.plan.id, "replaced");
    }

    const now = this.now();
    const events = plan.beats.flatMap((beat, index) => [
      { atMs: beat.atMs, order: index, kind: "start" as const, beat },
      { atMs: beat.atMs + beat.durationMs, order: index, kind: "end" as const, beat },
    ]).sort((a, b) => a.atMs - b.atMs || (a.kind === b.kind ? a.order - b.order : a.kind === "start" ? -1 : 1));

    const run: Run<TPayload> = { plan, allEvents: events, events: [...events], elapsedMs: 0, resumedAtMs: now, status: "running" };
    this.run = run;
    this.callbacks.onStart?.(plan);
    if (this.run !== run || run.status !== "running") return false;
    this.dispatchDueEvents(run);
    return this.isCurrentAndLive(run);
  }

  pause(planId: string): boolean {
    const run = this.currentRun(planId, "running");
    if (!run) return false;
    run.elapsedMs = this.elapsed(run);
    run.status = "paused";
    this.clearTimer(run);
    this.callbacks.onPause?.(planId, run.elapsedMs);
    return true;
  }

  resume(planId: string): boolean {
    const run = this.currentRun(planId, "paused");
    if (!run) return false;
    run.resumedAtMs = this.now();
    run.status = "running";
    this.callbacks.onResume?.(planId, run.elapsedMs);
    if (this.run === run && run.status === "running") this.dispatchDueEvents(run);
    return this.isCurrentAndLive(run);
  }

  cancel(planId: string, reason = "interrupted"): boolean {
    const run = this.currentRun(planId);
    if (!run || (run.status !== "running" && run.status !== "paused")) return false;
    run.elapsedMs = this.elapsed(run);
    run.status = "cancelled";
    this.clearTimer(run);
    this.callbacks.onCancel?.(planId, run.elapsedMs, reason);
    return true;
  }

  seek(planId: string, elapsedMs: number): boolean {
    const run = this.currentRun(planId);
    if (!run || (run.status !== "running" && run.status !== "paused") || !isNonNegativeSafeInteger(elapsedMs)) return false;
    this.clearTimer(run);
    run.elapsedMs = elapsedMs;
    run.resumedAtMs = this.now();
    // Rebuild from the immutable authored timeline so backward seeks are valid too.
    run.events = run.allEvents.filter((event) => event.atMs > elapsedMs);
    this.callbacks.onSeek?.({
      planId,
      elapsedMs,
      activeBeats: run.plan.beats.filter((beat) => beat.atMs <= elapsedMs && beat.atMs + beat.durationMs > elapsedMs),
    });
    if (!this.isCurrentAndLive(run)) return false;
    if (run.events.length === 0) {
      this.complete(run);
    } else if (run.status === "running") {
      this.dispatchDueEvents(run);
    }
    return this.isCurrentAndLive(run);
  }

  getStatus(planId: string): InkPlanStatus | undefined {
    return this.run?.plan.id === planId ? this.run.status : undefined;
  }

  private dispatchDueEvents(run: Run<TPayload>) {
    if (this.run !== run || run.status !== "running") return;
    const elapsedMs = this.elapsed(run);
    run.elapsedMs = elapsedMs;
    while (run.events[0]?.atMs <= elapsedMs) {
      const event = run.events.shift()!;
      const detail: InkPlanBeatEvent<TPayload> = { planId: run.plan.id, beat: event.beat, elapsedMs: event.atMs };
      if (event.kind === "start") this.callbacks.onBeatStart?.(detail);
      else this.callbacks.onBeatEnd?.(detail);
      if (this.run !== run || run.status !== "running") return;
    }
    if (run.events.length === 0) {
      this.complete(run);
      return;
    }
    const delayMs = Math.max(0, run.events[0].atMs - this.elapsed(run));
    run.timer = this.scheduleTimeout(() => {
      run.timer = undefined;
      this.dispatchDueEvents(run);
    }, delayMs);
  }

  private complete(run: Run<TPayload>) {
    if (this.run !== run || run.status === "cancelled" || run.status === "completed") return;
    run.elapsedMs = Math.max(run.elapsedMs, ...run.plan.beats.map((beat) => beat.atMs + beat.durationMs), 0);
    run.status = "completed";
    this.clearTimer(run);
    this.callbacks.onComplete?.(run.plan.id, run.elapsedMs);
  }

  private elapsed(run: Run<TPayload>) {
    return run.status === "running" ? run.elapsedMs + Math.max(0, this.now() - run.resumedAtMs) : run.elapsedMs;
  }

  private clearTimer(run: Run<TPayload>) {
    if (run.timer !== undefined) this.cancelTimeout(run.timer);
    run.timer = undefined;
  }

  private currentRun(planId: string, status?: InkPlanStatus) {
    const run = this.run;
    return run?.plan.id === planId && (!status || run.status === status) ? run : undefined;
  }

  private isCurrentAndLive(run: Run<TPayload>) {
    return this.run === run && run.status !== "cancelled";
  }

  private validatePlan(plan: InkPlan<TPayload>) {
    if (!plan.id) throw new Error("An ink plan requires a non-empty id.");
    const ids = new Set<string>();
    for (const beat of plan.beats) {
      if (!beat.id || ids.has(beat.id)) throw new Error("Ink plan beat ids must be non-empty and unique.");
      if (!isNonNegativeSafeInteger(beat.atMs) || !isNonNegativeSafeInteger(beat.durationMs)) {
        throw new Error("Ink plan timings must be non-negative safe integers.");
      }
      ids.add(beat.id);
    }
  }
}
