import { describe, expect, it } from "vitest";

import { parseHyperFramesJsonOutput } from "@/lib/render-worker";

describe("HyperFrames process output", () => {
  it("extracts the final check payload from noisy CLI output", () => {
    expect(parseHyperFramesJsonOutput([
      "[browser] {\"phase\":\"boot\"}",
      "notice: validating composition",
      "{\"ok\":true,\"checks\":[{\"name\":\"layout\",\"ok\":true}]}",
    ].join("\n"))).toMatchObject({ ok: true });
  });

  it("returns null when the renderer emits no JSON", () => {
    expect(parseHyperFramesJsonOutput("renderer terminated unexpectedly")).toBeNull();
  });
});
