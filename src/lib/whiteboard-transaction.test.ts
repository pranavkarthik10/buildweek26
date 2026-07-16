import { describe, expect, it } from "vitest";

import { validateBoardTransaction } from "@/lib/whiteboard-transaction";

describe("whiteboard transactions", () => {
  it("accepts bounded operations at the current version", () => {
    const result = validateBoardTransaction({
      transactionId: "teach-1",
      baseVersion: 4,
      ops: [{ type: "arrow", id: "arrow-1", x1: 10, y1: 20, x2: 80, y2: 70, color: "blue" }],
    }, 4);
    expect(result.ok).toBe(true);
  });

  it("returns a conflict for stale transactions", () => {
    const result = validateBoardTransaction({
      transactionId: "teach-2",
      baseVersion: 3,
      ops: [{ type: "text", id: "text-1", x: 10, y: 20, text: "hello" }],
    }, 4);
    expect(result).toMatchObject({ ok: false, code: "conflict", currentVersion: 4 });
  });

  it("rejects oversized or unbounded operations", () => {
    const result = validateBoardTransaction({
      transactionId: "teach-3",
      baseVersion: 0,
      ops: [{ type: "text", id: "text-1", x: 101, y: 20, text: "hello" }],
    }, 0);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
  });
});
