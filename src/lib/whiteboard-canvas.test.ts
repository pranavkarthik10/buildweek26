import { describe, expect, it } from "vitest";

import { whiteboardPagePoint } from "@/lib/whiteboard-canvas";

describe("whiteboard coordinate conversion", () => {
  it("converts normalized coordinates to the fixed board and clamps unsafe values", () => {
    expect(whiteboardPagePoint(50, 50)).toEqual({ x: 450, y: 280 });
    expect(whiteboardPagePoint(-10, 140)).toEqual({ x: 0, y: 560 });
    expect(whiteboardPagePoint(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0 });
  });
});
