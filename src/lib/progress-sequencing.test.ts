import { describe, expect, it } from "vitest";

import { isNewerProgressSequence } from "@/lib/progress-sequencing";

describe("progress sequencing", () => {
  it("accepts only strictly newer events", () => {
    expect(isNewerProgressSequence(4, 5)).toBe(true);
    expect(isNewerProgressSequence(4, 4)).toBe(false);
    expect(isNewerProgressSequence(4, 3)).toBe(false);
  });
});
