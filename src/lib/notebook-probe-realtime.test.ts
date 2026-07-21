import { describe, expect, it } from "vitest";

import {
  buildNotebookProbeRealtimeInstructions,
  NOTEBOOK_PROBE_REALTIME_SECRET_TTL_SECONDS,
} from "@/lib/notebook-probe-realtime";

describe("notebook probe realtime instructions", () => {
  it("keeps the server realtime session transcription-only", () => {
    const instructions = buildNotebookProbeRealtimeInstructions();

    expect(instructions).toContain("transcription-only");
    expect(instructions).toContain("Never create an audio or text response");
    expect(instructions).toContain("Never call tools");
  });

  it("uses a short-lived secret", () => {
    expect(NOTEBOOK_PROBE_REALTIME_SECRET_TTL_SECONDS).toBe(300);
  });
});
