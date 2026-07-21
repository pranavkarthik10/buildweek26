import type { TutorInkPlan } from "@/components/notebook-probe/probe-types";

const INTERNAL_VOICE_LEAK =
  /\b(plans?|beats?|client|tools?|models?|apis?|prompts?|region ids?|ink plan|stage[_\s-]?ink|request[_\s-]?ink|waiting for|handoff|narration brief)\b/i;

export function describeTutorInkHistory(plans: TutorInkPlan[]) {
  return plans.flatMap((plan) => plan.beats).flatMap((beat) => {
    const action = beat.action;
    return action.type === "write"
      ? [`"${action.text}" at x=${action.x.toFixed(3)}, y=${action.y.toFixed(3)}`]
      : [];
  }).join("; ");
}

/** Strip implementation chatter so learners only ever hear teaching language. */
export function sanitizeTutorVoiceCue(cue: string) {
  const cleaned = cue.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Watch this next step.";
  if (!INTERNAL_VOICE_LEAK.test(cleaned)) return cleaned.slice(0, 240);
  const kept = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !INTERNAL_VOICE_LEAK.test(part));
  return (kept.join(" ") || "Watch this next step.").slice(0, 240);
}

export function sanitizeTutorInkPlan(plan: TutorInkPlan): TutorInkPlan {
  return {
    ...plan,
    beats: plan.beats.map((beat) => ({
      ...beat,
      voiceCue: sanitizeTutorVoiceCue(beat.voiceCue),
    })),
  };
}

/** Keep later authored slices in a stable top-to-bottom working column. */
export function placeContinuationBelowExistingInk(plan: TutorInkPlan, history: TutorInkPlan[]): TutorInkPlan {
  const priorWrites = history.flatMap((candidate) => candidate.beats).flatMap((beat) => (
    beat.action.type === "write" ? [beat.action] : []
  ));
  let cursor = priorWrites.at(-1);

  return {
    ...plan,
    beats: plan.beats.map((beat) => {
      if (beat.action.type !== "write") return beat;
      if (!cursor) {
        cursor = beat.action;
        return beat;
      }
      let x = cursor?.x ?? beat.action.x;
      let y = (cursor?.y ?? beat.action.y) + 0.075;
      if (y > 1.28) {
        x = Math.min(1.08, x + 0.48);
        y = 0.58;
      }
      const action = { ...beat.action, x, y };
      cursor = action;
      return { ...beat, action };
    }),
  };
}
