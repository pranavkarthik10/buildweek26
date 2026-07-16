export type ExplainerEngine = "hyperframes" | "manim";
export type ExplainerStyle = "clean" | "chalk" | "math" | "diagram";

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

export type ExplainerBeat = {
  id: string;
  title: string;
  narration: string;
  visual: string;
  startSec: number;
  durationSec: number;
};

export type ExplainerSpec = {
  version: 1;
  engine: ExplainerEngine;
  style: ExplainerStyle;
  title: string;
  question: string;
  concept: string;
  goal: string;
  durationSec: 15 | 30 | 45;
  aspectRatio: "16:9";
  beats: ExplainerBeat[];
  citations: Array<{ label: string; slideNumber?: number }>;
};

export type RenderArtifactSummary = {
  id: string;
  jobKey: string;
  status: "preview" | "queued" | "processing" | "completed" | "failed";
  engine: ExplainerEngine;
  previewUrl?: string;
  artifactUrl?: string;
  error?: string;
};
