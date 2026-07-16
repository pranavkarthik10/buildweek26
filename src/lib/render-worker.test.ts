import { describe, expect, it } from "vitest";

import { compileManimScene, expressionToPython } from "@/lib/manim-compiler";

describe("Manim scene compiler", () => {
  it("compiles only application-owned scene primitives", () => {
    const source = compileManimScene({
      engine: "manim",
      objects: [
        { type: "axes", id: "axes", xRange: [-2, 2], yRange: [-1, 4] },
        { type: "graph", id: "curve", expression: { type: "power", base: { type: "variable", name: "x" }, exponent: 2 }, domain: [-2, 2] },
      ],
      actions: [{ type: "create", targetId: "curve", durationSec: 1 }],
    });
    expect(source).toContain("class StudydeckScene");
    expect(source).toContain("objects[\"curve\"]");
    expect(source).not.toContain("eval(");
  });

  it("translates the safe expression AST without executable input", () => {
    expect(expressionToPython({ type: "add", left: { type: "variable", name: "x" }, right: { type: "constant", value: 2 } })).toBe("(x + 2)");
  });
});
