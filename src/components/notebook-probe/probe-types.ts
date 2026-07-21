export type NormalizedPoint = { x: number; y: number };

export type ProbeGesture = {
  points: NormalizedPoint[];
  bounds?: { x: number; y: number; w: number; h: number };
};

export type ProbeRegion = {
  id: string;
  label: string;
  kind: "diagram" | "text" | "formula" | "table" | "image" | "other";
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
};

export type VisionProbeResult = {
  model: string;
  latencyMs: number;
  regions: ProbeRegion[];
  focusedRegionId: string | null;
};

export type TutorInkColor = "violet" | "red" | "blue" | "green" | "orange";

export type TutorInkAction =
  | { type: "circle"; targetRegionId: string; color: TutorInkColor }
  | { type: "arrow"; targetRegionId: string; placement: "north" | "east" | "south" | "west"; color: TutorInkColor }
  | { type: "label"; targetRegionId: string; text: string; placement: "north" | "east" | "south" | "west"; color: TutorInkColor }
  | { type: "write"; text: string; x: number; y: number; color: TutorInkColor }
  | { type: "underline"; x: number; y: number; width: number; color: TutorInkColor }
  /** Spoken reply with no new marks on the board. */
  | { type: "speak" };

export type TutorInkBeat = { id: string; atMs: number; durationMs: number; voiceCue: string; action: TutorInkAction };

export type TutorInkPlan = {
  id: string;
  summary: string;
  narrationBrief: string;
  beats: TutorInkBeat[];
};
