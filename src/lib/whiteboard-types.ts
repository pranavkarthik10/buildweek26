import type {
  AgentWhiteboardMode,
  LectureSlide,
  TutorSource,
  WhiteboardContent,
  WhiteboardMode,
} from "@/lib/aiprof-types";

export type TeachingFocus = "slides" | "whiteboard" | "split";

export type WhiteboardCanvasAction =
  | {
      type: "text";
      id: string;
      x: number;
      y: number;
      text: string;
      color?: string;
    }
  | {
      type: "geo";
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      geo: "rectangle" | "ellipse" | "triangle";
      color?: string;
    }
  | {
      type: "arrow";
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color?: string;
    }
  | {
      type: "draw";
      id: string;
      points: Array<{ x: number; y: number }>;
      color?: string;
    };

export type WhiteboardStepRecord = {
  stepIndex: number;
  summary: string;
  narration?: string;
};

export type WhiteboardStepRequest = {
  mode: WhiteboardMode;
  goal: string;
  slide: Pick<
    LectureSlide,
    "slideNumber" | "title" | "summary" | "bullets" | "coachNote"
  >;
  deckTitle?: string;
  courseName?: string;
  summary?: string;
  studyStrategy?: string;
  teachingFormat?: string;
  customInstructions?: string;
  question?: string;
  stepIndex: number;
  maxSteps?: number;
  tldrawSnapshot?: string;
  content?: WhiteboardContent;
  priorSteps?: WhiteboardStepRecord[];
};

export type WhiteboardStepResult = {
  status: "continue" | "done";
  focus: TeachingFocus;
  stepSummary: string;
  narration?: string;
  actions?: WhiteboardCanvasAction[];
  content?: WhiteboardContent;
};

export type TutorQuestionResult = {
  spokenAnswer: string;
  focus: TeachingFocus;
  sources?: TutorSource[];
  whiteboard?: {
    enabled: boolean;
    mode: AgentWhiteboardMode;
    goal: string;
    title?: string;
  };
};

export type WhiteboardSessionPlan = {
  /** When to start relative to scripted beats (0 = before first beat). */
  startAfterBeatIndex: number;
  mode: WhiteboardMode;
  goal: string;
  title?: string;
};
