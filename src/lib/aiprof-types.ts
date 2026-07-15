export type LectureCue = {
  id: string;
  label: string;
  emphasis: string;
  targetBullet: number;
  x: number;
  y: number;
};

export type TeachingFormat = "lecture" | "small_class" | "tutoring";

export type LectureSlide = {
  id: string;
  slideNumber: number;
  imageUrl: string;
  title: string;
  summary: string;
  bullets: string[];
  coachNote: string;
  examRelevance: "high" | "medium" | "low";
  cues: LectureCue[];
};

export type LectureDeck = {
  deckId: string;
  sourceUrl?: string;
  deckTitle: string;
  courseName: string;
  summary: string;
  studyStrategy: string;
  totalSlides: number;
  slides: LectureSlide[];
};

export type WhiteboardStroke = {
  id: string;
  kind: "line" | "arrow" | "circle" | "text";
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  text?: string;
  color?: string;
};

/** How the whiteboard renders AI / tutor output. */
export type WhiteboardMode = "canvas" | "manim" | "latex" | "text" | "strokes";

export type WhiteboardContent = {
  mode: WhiteboardMode;
  title?: string;
  /** Serialized tldraw document (agent-template style canvas). */
  tldrawSnapshot?: string;
  /** Manim Community scene source. */
  manimCode?: string;
  /** Pre-rendered Manim video URL when available. */
  manimVideoUrl?: string;
  /** LaTeX body (display math blocks without delimiters). */
  latex?: string;
  /** Plain text or markdown explanation. */
  text?: string;
  /** Legacy vector annotations overlaid on slides. */
  strokes?: WhiteboardStroke[];
};

/** Modes the lecture agent may request for a multi-step whiteboard session. */
export type AgentWhiteboardMode = Exclude<WhiteboardMode, "canvas"> | "canvas";

export type LectureBeat = {
  id: string;
  narration: string;
  action: "point" | "none";
  x?: number;
  y?: number;
  label?: string;
  emphasis?: string;
  pauseAfterMs: number;
};

export type LectureSegment = {
  slideNumber: number;
  skipSlide?: boolean;
  askCheckpoint?: boolean;
  checkpointQuestion?: string;
  endPauseMs?: number;
  beats: LectureBeat[];
  /** Multi-step whiteboard work during this slide (not a single payload). */
  whiteboardPlan?: {
    startAfterBeatIndex: number;
    mode: WhiteboardMode;
    goal: string;
    title?: string;
  };
};
