import { createHash } from "node:crypto";

import type {
  ExplainerRequestInput,
  ExplainerStyle,
  ManimVisualSpec,
  VisualExplainerSpec,
  VisualEngine,
} from "@/lib/explainer-types";
import { validateVisualSpec } from "@/lib/visual-spec";

export function normalizeExplainerInput(input: ExplainerRequestInput) {
  const duration = input.durationSec === 45 ? 45 : input.durationSec === 30 ? 30 : 15;
  const style: ExplainerStyle = ["clean", "chalk", "math", "diagram"].includes(input.visualStyle ?? "")
    ? (input.visualStyle as ExplainerStyle)
    : "clean";
  const question = input.question.trim().slice(0, 500);
  const concept = input.concept.trim().slice(0, 180);
  const goal = input.goal.trim().slice(0, 400);
  if (!question || !concept || !goal) throw new Error("question, concept, and goal are required.");
  return { ...input, question, concept, goal, durationSec: duration as 15 | 30 | 45, visualStyle: style };
}

export function chooseExplainerEngine(input: Pick<ExplainerRequestInput, "question" | "concept" | "goal">): VisualEngine {
  const text = `${input.question} ${input.concept} ${input.goal}`.toLowerCase();
  if (/process|workflow|flow|cutoff|recorded in|correct year|transaction|steps|compare .* versus/.test(text)) return "diagram";
  if (/chart|graph|data|trend|sales|revenue|inventory|percent|percentage|statistics|average|forecast|compare/.test(text)) return "plotly";
  if (/geometry|triangle|circle|coordinate|function graph|slope field|manipulate|slider/.test(text)) return "jsxgraph";
  if (/derivative|integral|equation|proof|theorem|vector|matrix|calculus|limit|chain rule|physics|animate|animation/.test(text)) return "manim";
  return "diagram";
}

export function buildExplainerSpec(raw: ExplainerRequestInput): VisualExplainerSpec {
  const input = normalizeExplainerInput(raw);
  const engine = chooseExplainerEngine(input);
  const beatDuration = input.durationSec / 3;
  const captions = [
    { id: "orient", text: `Let's make ${input.concept} visible before we manipulate it.`, startSec: 0, durationSec: beatDuration },
    { id: "build", text: input.goal, startSec: beatDuration, durationSec: beatDuration },
    { id: "connect", text: `Now connect the picture back to the original question: ${input.question}`, startSec: beatDuration * 2, durationSec: beatDuration },
  ];
  const citations = input.slide ? [{ label: `Slide ${input.slide.slideNumber}: ${input.slide.title}`, slideNumber: input.slide.slideNumber }] : [];
  const visual = buildVisual(engine, input);
  return validateVisualSpec({
    version: 2,
    kind: engine === "manim" ? "video" : "interactive",
    engine,
    style: input.visualStyle,
    title: `Visualizing ${input.concept}`,
    question: input.question,
    concept: input.concept,
    goal: input.goal,
    durationSec: input.durationSec,
    aspectRatio: "16:9",
    captions,
    citations,
    visual,
  });
}

function buildVisual(engine: VisualEngine, input: ReturnType<typeof normalizeExplainerInput>) {
  if (engine === "plotly") {
    return {
      engine,
      chartType: "bar" as const,
      x: ["Before", "Correct period", "Reported total"],
      series: [{ name: input.concept.slice(0, 80), values: [35, 52, 68], color: "#59d4c6" }],
      xLabel: "Scenario",
      yLabel: "Illustrative value",
    };
  }
  if (engine === "jsxgraph") {
    return {
      engine,
      viewport: { xMin: -5, xMax: 5, yMin: -3, yMax: 8 },
      objects: [
        { type: "function" as const, id: "curve", expression: { type: "power" as const, base: { type: "variable" as const, name: "x" }, exponent: 2 }, domain: [-4, 4], label: input.concept },
        { type: "point" as const, id: "origin", x: 0, y: 0, label: "Start" },
        { type: "slider" as const, id: "focus", min: -4, max: 4, value: 1, label: "Focus" },
      ],
    };
  }
  if (engine === "manim") {
    const visual: ManimVisualSpec = {
      engine,
      objects: [
        { type: "text", id: "title", text: input.concept, y: 2.8 },
        { type: "formula", id: "formula", latex: input.concept.toLowerCase().includes("chain") ? "(f \\circ g)' = (f' \\circ g)g'" : "y = x^2", y: 0.4 },
        { type: "axes", id: "axes", xRange: [-4, 4], yRange: [-2, 6] },
        { type: "graph", id: "graph", expression: { type: "power", base: { type: "variable", name: "x" }, exponent: 2 }, domain: [-3, 3] },
      ],
      actions: [
        { type: "write", targetId: "title", durationSec: 1 },
        { type: "create", targetId: "axes", durationSec: 1 },
        { type: "create", targetId: "graph", durationSec: 2 },
        { type: "write", targetId: "formula", durationSec: 2 },
        { type: "highlight", targetId: "formula", durationSec: 1 },
      ],
    };
    return visual;
  }
  return {
    engine: "diagram" as const,
    nodes: [
      { id: "question", label: input.question, x: 16, y: 48, tone: "accent" as const },
      { id: "idea", label: input.concept, value: input.goal, x: 50, y: 28, tone: "secondary" as const },
      { id: "example", label: "Try a new example", x: 82, y: 48, tone: "warning" as const },
    ],
    edges: [
      { id: "question-idea", from: "question", to: "idea", label: "build" },
      { id: "idea-example", from: "idea", to: "example", label: "connect" },
    ],
    steps: [
      { id: "orient", title: "The question", narration: captionsFor(input)[0], nodeIds: ["question"], startSec: 0, durationSec: input.durationSec / 3 },
      { id: "build", title: "Build the idea", narration: input.goal, nodeIds: ["idea"], edgeIds: ["question-idea"], startSec: input.durationSec / 3, durationSec: input.durationSec / 3 },
      { id: "connect", title: "Connect it back", narration: "Try the idea on a new example, then explain what changed.", nodeIds: ["example"], edgeIds: ["idea-example"], startSec: input.durationSec * 2 / 3, durationSec: input.durationSec / 3 },
    ],
  };
}

function captionsFor(input: ReturnType<typeof normalizeExplainerInput>) {
  return `Let's make ${input.concept} visible before we manipulate it.`;
}

export function jobKeyForSpec(spec: VisualExplainerSpec) {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 48);
}
