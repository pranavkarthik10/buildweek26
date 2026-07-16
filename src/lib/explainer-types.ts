export type VisualEngine = "diagram" | "jsxgraph" | "plotly" | "manim";
export type VisualArtifactKind = "interactive" | "video";
export type ExplainerStyle = "clean" | "chalk" | "math" | "diagram";

export type CaptionBeat = {
  id: string;
  text: string;
  startSec: number;
  durationSec: number;
};

export type VisualNode = {
  id: string;
  label: string;
  value?: string;
  x: number;
  y: number;
  tone?: "accent" | "secondary" | "muted" | "warning";
};

export type VisualEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
};

export type VisualStep = {
  id: string;
  title: string;
  narration: string;
  nodeIds?: string[];
  edgeIds?: string[];
  startSec: number;
  durationSec: number;
};

export type DiagramVisualSpec = {
  engine: "diagram";
  nodes: VisualNode[];
  edges: VisualEdge[];
  steps: VisualStep[];
};

export type MathExpression =
  | { type: "constant"; value: number }
  | { type: "variable"; name: "x" | "y" | "t" }
  | { type: "add" | "subtract" | "multiply" | "divide"; left: MathExpression; right: MathExpression }
  | { type: "power"; base: MathExpression; exponent: number }
  | { type: "sin" | "cos" | "tan" | "exp" | "log" | "sqrt"; value: MathExpression };

export type JSXGraphVisualSpec = {
  engine: "jsxgraph";
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  objects: Array<
    | { type: "point"; id: string; x: number; y: number; label?: string }
    | { type: "segment"; id: string; from: [number, number]; to: [number, number]; label?: string }
    | { type: "circle"; id: string; center: [number, number]; radius: number; label?: string }
    | { type: "function"; id: string; expression: MathExpression; domain: [number, number]; label?: string }
    | { type: "slider"; id: string; min: number; max: number; value: number; label: string }
  >;
};

export type PlotlyVisualSpec = {
  engine: "plotly";
  chartType: "line" | "bar" | "scatter";
  x: Array<string | number>;
  series: Array<{ name: string; values: number[]; color?: string }>;
  frames?: Array<{ name: string; series: number[][] }>;
  xLabel?: string;
  yLabel?: string;
};

export type ManimVisualSpec = {
  engine: "manim";
  objects: Array<
    | { type: "text"; id: string; text: string; x?: number; y?: number }
    | { type: "formula"; id: string; latex: string; x?: number; y?: number }
    | { type: "circle"; id: string; x: number; y: number; radius: number }
    | { type: "line" | "arrow"; id: string; from: [number, number]; to: [number, number] }
    | { type: "axes"; id: string; xRange: [number, number]; yRange: [number, number] }
    | { type: "graph"; id: string; expression: MathExpression; domain: [number, number] }
  >;
  actions: Array<
    | { type: "write" | "create" | "fadeIn" | "fadeOut"; targetId: string; durationSec: number }
    | { type: "transform"; fromId: string; toId: string; durationSec: number }
    | { type: "highlight"; targetId: string; durationSec: number }
  >;
};

export type VisualExplainerSpec = {
  version: 2;
  kind: VisualArtifactKind;
  engine: VisualEngine;
  style: ExplainerStyle;
  title: string;
  question: string;
  concept: string;
  goal: string;
  durationSec: 15 | 30 | 45;
  aspectRatio: "16:9";
  captions: CaptionBeat[];
  citations: Array<{ label: string; slideNumber?: number }>;
  visual: DiagramVisualSpec | JSXGraphVisualSpec | PlotlyVisualSpec | ManimVisualSpec;
  audioUrl?: string;
};

export type ExplainerRequestInput = {
  sessionId?: string;
  question: string;
  concept: string;
  goal: string;
  durationSec?: number;
  visualStyle?: ExplainerStyle;
  deckTitle?: string;
  courseName?: string;
  slide?: {
    slideNumber: number;
    title: string;
    summary: string;
    bullets: string[];
    imageUrl?: string;
  };
};

export type RenderArtifactSummary = {
  id: string;
  jobKey: string;
  status: "preview" | "queued" | "processing" | "completed" | "failed";
  kind: VisualArtifactKind;
  engine: VisualEngine;
  artifactUrl?: string;
  audioUrl?: string;
  captions?: CaptionBeat[];
  specUrl?: string;
  error?: string;
};

/** Backwards-compatible names for callers that still use the old planner vocabulary. */
export type ExplainerEngine = VisualEngine;
export type ExplainerBeat = CaptionBeat;
export type ExplainerSpec = VisualExplainerSpec;
