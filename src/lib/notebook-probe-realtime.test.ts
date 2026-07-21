import { describe, expect, it } from "vitest";

import {
  buildNotebookProbeRealtimeInstructions,
  NOTEBOOK_PROBE_REALTIME_SECRET_TTL_SECONDS,
} from "@/lib/notebook-probe-realtime";

describe("notebook probe realtime instructions", () => {
  it("keeps narration bound to Terra beats and interruption-safe", () => {
    const instructions = buildNotebookProbeRealtimeInstructions();

    expect(instructions).toContain("finish EVERY beat in the SAME turn");
    expect(instructions).toContain("request_ink_plan");
    expect(instructions).toContain("stage_ink_beat");
    expect(instructions).toContain("Never stage several beats in advance");
    expect(instructions).toContain("Only make visual claims");
    expect(instructions).toContain("If the learner interrupts");
    expect(instructions).toContain("check their work");
    expect(instructions).toContain("Do not ask them to point first");
    expect(instructions).toContain("do NOT re-derive the previous problem");
    expect(instructions).not.toContain("diagram lesson");
  });

  it("uses a short-lived secret", () => {
    expect(NOTEBOOK_PROBE_REALTIME_SECRET_TTL_SECONDS).toBe(300);
  });
});
