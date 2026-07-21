/**
 * Board-memory turn routing for the notebook tutor.
 * A seamless loop appends to the board; it only clears for a clearly new problem.
 */

import type { TutorInkPlan } from "@/components/notebook-probe/probe-types";

export type TutorTurnIntent =
  | "handoff"
  | "resume"
  | "followup"
  | "clarify"
  | "ack"
  | "check_work"
  | "new_problem"
  | "explain";

export type TutorTurnContext = {
  hasTutorInk: boolean;
  hasLearnerInk: boolean;
  canResume: boolean;
};

export function isLearnerTakingATurn(question: string) {
  const q = question.trim().toLowerCase();
  if (/\b(check|look over|mark|correct|is this right|did i|help me (with|on))\b/.test(q)) return false;
  return (
    /\b(i('ll| will)? (try|do|work|solve|attempt)|let me (try|do|work|solve)|my turn|i want to try|i'?m (gonna|going to) (try|do)|i can (try|do) it)\b/.test(q)
    || /\b(try (the )?next|do (the )?next( one| problem)?|work (on )?(the )?next)\b/.test(q)
  );
}

export function isContinueRequest(question: string) {
  const q = question.trim().toLowerCase();
  if (isLearnerTakingATurn(q)) return false;
  if (isAcknowledgement(q)) return false;
  return (
    /^(continue|cont\.?|next( step| line| one)?|keep going|go on|go ahead|finish( it)?|and then\??|what'?s next\??|more|keep on)\.?$/.test(q)
    || /\b(continue|keep going|next step|go on|finish the (rest|derivation|solution)|write (it |that )?out|show (me )?the (next|rest))\b/.test(q)
  );
}

export function isAcknowledgement(question: string) {
  const q = question.trim().toLowerCase();
  return (
    /^(thanks|thank you|thx|ty|got it|makes sense|cool|great|perfect|awesome|nice|alright|all right|sounds good|that helps|ok|okay|k)\.?(!)?$/i.test(q)
    || /^(thanks|thank you)([,!]?\s+.{0,40})?$/i.test(q)
  );
}

/** Question about work already on the board — answer out loud, don't keep writing. */
export function isClarifyRequest(question: string) {
  const q = question.trim().toLowerCase();
  if (isContinueRequest(q) || isAcknowledgement(q) || isNewProblemRequest(q) || isLearnerTakingATurn(q)) return false;
  return (
    /^(why|what|how|when|where|which|who)\b/.test(q)
    || /\b(why|what does|what did|how come|can you explain|what do you mean|i don'?t (get|understand)|confused|clarify|mean by|simplify that|say that again)\b/.test(q)
    || /\?$/.test(q)
  );
}

export function isCheckWorkRequest(question: string) {
  return /\b(check|look over|review|grade|mark|correct|did i|is this|am i|my work|my answer|tried|finished|done|wrong|mistake|error|stuck on my)\b/i.test(question);
}

/** Explicit move to a different problem — the only case that should wipe tutor ink. */
export function isNewProblemRequest(question: string) {
  const q = question.trim().toLowerCase();
  return (
    /\b(different|another|other|new)\s+(problem|question|one|exercise)\b/.test(q)
    || /\b(problem|question|exercise)\s*#?\s*\d+\b/.test(q)
    || /\b(now|instead)\s+(do|help|solve|look at)\b/.test(q)
    || /\bhelp me (with|on) (this|the) (other|next|previous)\b/.test(q)
    || /^(next problem|previous problem|other problem)\.?$/.test(q)
  );
}

export function classifyTutorIntent(question: string, context: TutorTurnContext): TutorTurnIntent {
  const q = question.trim();
  if (!q) return "explain";
  if (isLearnerTakingATurn(q)) return "handoff";
  if (isContinueRequest(q) && context.canResume) return "resume";
  if (context.hasTutorInk && isAcknowledgement(q)) return "ack";
  if (isCheckWorkRequest(q) && context.hasLearnerInk) return "check_work";
  if (isNewProblemRequest(q)) return "new_problem";
  if (context.hasTutorInk && isClarifyRequest(q)) return "clarify";
  if (context.hasTutorInk && isContinueRequest(q)) return "followup";
  // Board already has tutor work: prefer a spoken answer over inventing more writing.
  if (context.hasTutorInk) return "clarify";
  return "explain";
}

/** Clear the board only when starting a fresh problem (or first explain with nothing to keep). */
export function shouldPreserveTutorInk(intent: TutorTurnIntent) {
  return intent !== "new_problem" && intent !== "explain";
}

export function authorIntentForTurn(intent: TutorTurnIntent): "explain" | "check_work" | "clarify" {
  if (intent === "check_work") return "check_work";
  if (intent === "clarify" || intent === "ack") return "clarify";
  return "explain";
}

export function buildAckPlan(): TutorInkPlan {
  return {
    id: crypto.randomUUID(),
    summary: "Acknowledge the learner",
    narrationBrief: "Short spoken acknowledgement; no new ink.",
    beats: [
      {
        id: "ack",
        atMs: 0,
        durationMs: 500,
        voiceCue: "Anytime. Try the next one when you're ready.",
        action: { type: "speak" },
      },
    ],
  };
}

function normalizeForEcho(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Speaker bleed often re-transcribes the tutor’s last cue (or a fragment of it).
 * Real barge-in phrases diverge enough to fail this check.
 */
export function isEchoOfTutorCue(transcript: string, lastVoiceCue: string | undefined) {
  if (!lastVoiceCue) return false;
  const heard = normalizeForEcho(transcript);
  const spoken = normalizeForEcho(lastVoiceCue);
  if (!heard || !spoken) return false;
  if (heard === spoken) return true;
  if (heard.length >= 8 && (spoken.includes(heard) || heard.includes(spoken))) return true;
  const heardTokens = new Set(heard.split(" ").filter((token) => token.length > 2));
  const spokenTokens = spoken.split(" ").filter((token) => token.length > 2);
  if (heardTokens.size === 0 || spokenTokens.length === 0) return false;
  let overlap = 0;
  for (const token of spokenTokens) {
    if (heardTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(heardTokens.size, spokenTokens.length) >= 0.72;
}
