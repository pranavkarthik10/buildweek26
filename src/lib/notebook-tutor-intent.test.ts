import { describe, expect, it } from "vitest";

import {
  classifyTutorIntent,
  isAcknowledgement,
  isClarifyRequest,
  isEchoOfTutorCue,
  isNewProblemRequest,
  shouldPreserveTutorInk,
} from "@/lib/notebook-tutor-intent";

describe("notebook tutor intent", () => {
  it("hands off when the learner wants to try next", () => {
    expect(classifyTutorIntent("I'll try the next one", {
      hasTutorInk: true,
      hasLearnerInk: false,
      canResume: true,
    })).toBe("handoff");
  });

  it("resumes a paused unfinished segment on continue", () => {
    expect(classifyTutorIntent("continue", {
      hasTutorInk: true,
      hasLearnerInk: false,
      canResume: true,
    })).toBe("resume");
  });

  it("acks thanks without treating it as more writing", () => {
    expect(isAcknowledgement("thanks")).toBe(true);
    expect(classifyTutorIntent("thanks", {
      hasTutorInk: true,
      hasLearnerInk: false,
      canResume: false,
    })).toBe("ack");
    expect(shouldPreserveTutorInk("ack")).toBe(true);
  });

  it("clarifies questions about existing work instead of appending ink", () => {
    expect(isClarifyRequest("why did you divide both sides?")).toBe(true);
    expect(classifyTutorIntent("why did you divide both sides?", {
      hasTutorInk: true,
      hasLearnerInk: false,
      canResume: false,
    })).toBe("clarify");
    expect(classifyTutorIntent("what does that mean", {
      hasTutorInk: true,
      hasLearnerInk: false,
      canResume: false,
    })).toBe("clarify");
  });

  it("keeps explicit write-continuations as followups", () => {
    expect(classifyTutorIntent("keep going", {
      hasTutorInk: true,
      hasLearnerInk: false,
      canResume: false,
    })).toBe("followup");
    expect(shouldPreserveTutorInk("followup")).toBe(true);
  });

  it("only clears the board for a clearly new problem or first explain", () => {
    expect(isNewProblemRequest("help me with a different problem")).toBe(true);
    expect(classifyTutorIntent("help me with problem 4", {
      hasTutorInk: true,
      hasLearnerInk: true,
      canResume: false,
    })).toBe("new_problem");
    expect(shouldPreserveTutorInk("new_problem")).toBe(false);
    expect(shouldPreserveTutorInk("explain")).toBe(false);
    expect(shouldPreserveTutorInk("check_work")).toBe(true);
  });

  it("routes check-work when the learner marked the page", () => {
    expect(classifyTutorIntent("can you check my work", {
      hasTutorInk: true,
      hasLearnerInk: true,
      canResume: false,
    })).toBe("check_work");
  });

  it("starts with explain when the board is empty", () => {
    expect(classifyTutorIntent("help me derive this", {
      hasTutorInk: false,
      hasLearnerInk: true,
      canResume: false,
    })).toBe("explain");
  });
});

describe("tutor echo filtering", () => {
  it("detects speaker-bleed of the last voice cue", () => {
    const cue = "Differentiate both sides with respect to x.";
    expect(isEchoOfTutorCue("Differentiate both sides with respect to x.", cue)).toBe(true);
    expect(isEchoOfTutorCue("differentiate both sides", cue)).toBe(true);
  });

  it("allows real barge-in phrases through", () => {
    const cue = "Differentiate both sides with respect to x.";
    expect(isEchoOfTutorCue("wait why did you do that", cue)).toBe(false);
    expect(isEchoOfTutorCue("stop, I have a question", cue)).toBe(false);
  });
});
