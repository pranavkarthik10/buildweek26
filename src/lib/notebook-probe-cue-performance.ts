/**
 * Renderer-neutral ownership for a cue-driven performance. Realtime (or any
 * other transport) can retry and arrive out of order without making a renderer
 * replay an already accepted beat.
 */
export type CuePerformancePlan<TBeat extends { id: string }> = {
  id: string;
  beats: readonly TBeat[];
};

export type CueClaim<TBeat> =
  | { kind: "accepted"; beat: TBeat }
  | { kind: "duplicate" }
  | { kind: "stale" }
  | { kind: "unknown" };

type ActivePerformance<TBeat extends { id: string }> = {
  id: string;
  beats: ReadonlyMap<string, TBeat>;
  acceptedBeatIds: Set<string>;
};

export class CuePerformance<TBeat extends { id: string }> {
  private active?: ActivePerformance<TBeat>;

  begin(plan: CuePerformancePlan<TBeat>) {
    const ids = new Set<string>();
    for (const beat of plan.beats) {
      if (!beat.id || ids.has(beat.id)) return false;
      ids.add(beat.id);
    }
    this.active = {
      id: plan.id,
      beats: new Map(plan.beats.map((beat) => [beat.id, beat])),
      acceptedBeatIds: new Set(),
    };
    return true;
  }

  claim(planId: string, beatId: string): CueClaim<TBeat> {
    const active = this.active;
    if (!active || active.id !== planId) return { kind: "stale" };
    const beat = active.beats.get(beatId);
    if (!beat) return { kind: "unknown" };
    if (active.acceptedBeatIds.has(beatId)) return { kind: "duplicate" };
    active.acceptedBeatIds.add(beatId);
    return { kind: "accepted", beat };
  }

  cancel(planId?: string) {
    if (!this.active || (planId && this.active.id !== planId)) return false;
    this.active = undefined;
    return true;
  }

  get activePlanId() {
    return this.active?.id;
  }
}
