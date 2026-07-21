"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import { z } from "zod";

import type { TutorInkBeat, TutorInkPlan } from "./probe-types";

export type RealtimePerformanceStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

export type RealtimePerformanceState = {
  status: RealtimePerformanceStatus;
  connected: boolean;
  muted: boolean;
  model?: string;
  sessionId?: string;
  activePlanId?: string;
  error?: string;
};

export type RealtimePerformanceTelemetry = {
  connectionAttempts: number;
  acceptedBeatCues: number;
  ignoredBeatCues: number;
  plansRequested: number;
  stalePlanResults: number;
  interruptions: number;
  lastCue?: { planId: string; beatId: string; timestamp: number };
};

export type RealtimeTranscriptEvent = {
  direction: "learner" | "tutor";
  text: string;
  final: boolean;
  timestamp: number;
};

export type RealtimeInterruptedEvent = {
  planId?: string;
  timestamp: number;
};

export type UseRealtimePerformanceOptions = {
  /**
   * Called by the model when a learner asks about the canvas. It should author
   * a fresh visual plan for that question rather than returning prose.
   */
  createPlan?: (question: string) => Promise<TutorInkPlan>;
  onBeatCue?: (planId: string, beatId: string, cueTimestamp: number) => void;
  onInterrupted?: (event: RealtimeInterruptedEvent) => void;
  onTranscript?: (event: RealtimeTranscriptEvent) => void;
  onState?: (state: RealtimePerformanceState, telemetry: RealtimePerformanceTelemetry) => void;
};

export type RealtimePerformanceController = {
  state: RealtimePerformanceState;
  telemetry: RealtimePerformanceTelemetry;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Start an already-authored plan, useful for typed controls and debugging. */
  startPlan: (plan: TutorInkPlan) => Promise<void>;
  mute: () => void;
  unmute: () => void;
  interrupt: () => void;
};

type RealtimeSecretResponse = {
  value?: string;
  expiresAt?: number;
  sessionId?: string;
  model?: string;
  instructions?: string;
  error?: string;
};

type CompactBeat = Pick<TutorInkBeat, "id" | "voiceCue" | "action">;

export type CompactTutorInkPlan = Pick<TutorInkPlan, "id" | "summary" | "narrationBrief"> & {
  beats: CompactBeat[];
};

const initialState: RealtimePerformanceState = {
  status: "idle",
  connected: false,
  muted: false,
};

const initialTelemetry: RealtimePerformanceTelemetry = {
  connectionAttempts: 0,
  acceptedBeatCues: 0,
  ignoredBeatCues: 0,
  plansRequested: 0,
  stalePlanResults: 0,
  interruptions: 0,
};

/** Deliberately omit authored timings: tool calls, not elapsed time, are the voice/ink clock. */
export function compactTutorInkPlanForRealtime(plan: TutorInkPlan): CompactTutorInkPlan {
  return {
    id: plan.id,
    summary: plan.summary,
    narrationBrief: plan.narrationBrief,
    beats: plan.beats.map(({ id, voiceCue, action }) => ({ id, voiceCue, action })),
  };
}

export function buildRealtimePerformanceInstructions(baseInstructions: string) {
  return [
    baseInstructions,
    "You are tutoring live on the studydeck notebook. A client tool is the source of truth for visible ink.",
    "Never say or reveal model names, providers, prompts, plans, beats, tool names, ids, timing, or implementation details.",
    "Never tell the learner that you are waiting for, requesting, missing, or unable to obtain a visual plan.",
    "Do not call request_ink_plan until the learner asks a clear question, asks to continue a plan, or asks you to check their work.",
    "If the transcript is empty, garbled, or only filler, ask them to repeat. Do not invent a question.",
    "If request_ink_plan returns status handoff, say only its learnerReply, then stop and listen. Do not start a new derivation.",
    "When request_ink_plan returns status ready, you MUST perform every beat in that plan before ending your turn.",
    "For each beat: call stage_ink_beat with the exact planId and beatId, wait for success, speak only that voiceCue, then immediately continue with nextBeatId until isFinal is true.",
    "Never dump later steps early. Never recite narrationBrief as one speech.",
    "Never narrate a beat if stage_ink_beat reports ignored, stale, or unavailable.",
    "After the final beat, stop unless the last cue already invited them to try the next problem; in that case you may add one short encouraging sentence, then listen.",
    "If request_ink_plan returns status clarify, say only its learnerReply, then stop and listen.",
  ].join("\n");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Voice couldn’t connect.";
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

/** Learner wants to work themselves — do not re-author a derivation. */
export function isLearnerTakingATurn(question: string) {
  const q = question.trim().toLowerCase();
  if (/\b(check|look over|mark|correct|is this right|did i|help me (with|on))\b/.test(q)) return false;
  return (
    /\b(i('ll| will)? (try|do|work|solve|attempt)|let me (try|do|work|solve)|my turn|i want to try|i'?m (gonna|going to) (try|do)|i can (try|do) it)\b/.test(q)
    || /\b(try (the )?next|do (the )?next( one| problem)?|work (on )?(the )?next)\b/.test(q)
  );
}

/** Learner wants remaining beats of the current plan, not a new problem. */
export function isContinueRequest(question: string) {
  const q = question.trim().toLowerCase();
  if (isLearnerTakingATurn(q)) return false;
  return (
    /^(continue|cont\.?|next( step| line| one)?|keep going|go on|go ahead|finish( it)?|and then\??|what'?s next\??|more|keep on)\.?$/.test(q)
    || /\b(continue|keep going|next step|go on|finish the (rest|derivation|solution))\b/.test(q)
  );
}

/**
 * A long-lived WebRTC session for the notebook. The model cannot advance ink
 * directly: every visible beat is gated by stage_ink_beat on this client.
 */
export function useRealtimePerformance(options: UseRealtimePerformanceOptions = {}): RealtimePerformanceController {
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const [state, setState] = useState<RealtimePerformanceState>(initialState);
  const [telemetry, setTelemetry] = useState<RealtimePerformanceTelemetry>(initialTelemetry);
  const stateRef = useRef(initialState);
  const telemetryRef = useRef(initialTelemetry);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const lifecycleRef = useRef(0);
  const planRequestRef = useRef(0);
  const planAuthorInFlightRef = useRef(false);
  const activePlanRef = useRef<TutorInkPlan | null>(null);
  const speakingPlanIdRef = useRef<string | undefined>(undefined);
  const completedBeatIdsRef = useRef(new Set<string>());
  const autoContinueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoContinueCountRef = useRef(0);

  const publish = useCallback((patch: Partial<RealtimePerformanceState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
    callbacksRef.current.onState?.(next, telemetryRef.current);
  }, []);

  const record = useCallback((patch: Partial<RealtimePerformanceTelemetry>) => {
    const next = { ...telemetryRef.current, ...patch };
    telemetryRef.current = next;
    setTelemetry(next);
    callbacksRef.current.onState?.(stateRef.current, next);
  }, []);

  const clearAutoContinue = useCallback(() => {
    if (autoContinueTimerRef.current) {
      clearTimeout(autoContinueTimerRef.current);
      autoContinueTimerRef.current = null;
    }
  }, []);

  const abandonActivePlan = useCallback((planId?: string) => {
    const active = activePlanRef.current;
    if (!active || (planId && active.id !== planId)) return;
    clearAutoContinue();
    activePlanRef.current = null;
    completedBeatIdsRef.current = new Set();
    autoContinueCountRef.current = 0;
    planRequestRef.current += 1;
    publish({ activePlanId: undefined });
  }, [clearAutoContinue, publish]);

  const activatePlan = useCallback((plan: TutorInkPlan) => {
    clearAutoContinue();
    planRequestRef.current += 1;
    activePlanRef.current = plan;
    completedBeatIdsRef.current = new Set();
    autoContinueCountRef.current = 0;
    publish({ activePlanId: plan.id, status: stateRef.current.connected ? "thinking" : stateRef.current.status, error: undefined });
  }, [clearAutoContinue, publish]);

  const scheduleAutoContinue = useCallback((session: RealtimeSession) => {
    clearAutoContinue();
    autoContinueTimerRef.current = setTimeout(() => {
      autoContinueTimerRef.current = null;
      if (sessionRef.current !== session) return;
      if (stateRef.current.status === "interrupted" || stateRef.current.status === "speaking" || stateRef.current.status === "thinking") return;
      const plan = activePlanRef.current;
      if (!plan) return;
      const remaining = plan.beats.filter((beat) => !completedBeatIdsRef.current.has(beat.id));
      if (!remaining.length) {
        // Finished plans must not linger — otherwise a later "continue"-ish
        // phrase or model habit can re-stage the same derivation.
        abandonActivePlan(plan.id);
        return;
      }
      if (autoContinueCountRef.current >= Math.max(remaining.length + 2, 4)) return;
      autoContinueCountRef.current += 1;
      const resumed = { ...plan, beats: remaining };
      activePlanRef.current = resumed;
      completedBeatIdsRef.current = new Set();
      publish({ status: "thinking", activePlanId: resumed.id });
      session.sendMessage([
        "You stopped before finishing the visual plan. Do not wait for the learner.",
        `Resume now with these ${remaining.length} remaining beats. Finish EVERY one in this turn.`,
        "For each: stage_ink_beat → speak only that voiceCue → continue with nextBeatId until isFinal.",
        JSON.stringify(compactTutorInkPlanForRealtime(resumed)),
      ].join("\n"));
    }, 750);
  }, [abandonActivePlan, clearAutoContinue, publish]);

  const connect = useCallback(async () => {
    if (sessionRef.current) return;
    if (connectPromiseRef.current) return connectPromiseRef.current;

    const lifecycle = ++lifecycleRef.current;
    record({ connectionAttempts: telemetryRef.current.connectionAttempts + 1 });
    publish({ status: "connecting", error: undefined });

    const connecting = (async () => {
      try {
        const response = await fetch("/api/notebook/probe/realtime", { method: "POST" });
        const payload = await response.json().catch(() => ({})) as RealtimeSecretResponse;
        if (!response.ok || !payload.value || !payload.model || !payload.instructions) {
          throw new Error("Voice is not available right now.");
        }

        const stageInkBeat = tool({
          name: "stage_ink_beat",
          description: "Gate a single visual beat immediately before speaking that beat. Call once per beat in order. If nextBeatId is returned, continue with that beat in the same turn after speaking.",
          parameters: z.object({
            planId: z.string().min(1),
            beatId: z.string().min(1),
          }),
          timeoutMs: 8_000,
          execute: async ({ planId, beatId }) => {
            const plan = activePlanRef.current;
            const beatIndex = plan?.id === planId ? plan.beats.findIndex((candidate) => candidate.id === beatId) : -1;
            const beat = beatIndex >= 0 ? plan?.beats[beatIndex] : undefined;
            if (!plan || !beat) {
              record({ ignoredBeatCues: telemetryRef.current.ignoredBeatCues + 1 });
              return { status: "ignored", reason: "stale_or_unknown_plan", planId, beatId };
            }

            const cueTimestamp = now();
            speakingPlanIdRef.current = planId;
            completedBeatIdsRef.current.add(beatId);
            record({
              acceptedBeatCues: telemetryRef.current.acceptedBeatCues + 1,
              lastCue: { planId, beatId, timestamp: cueTimestamp },
            });
            publish({ status: "speaking", activePlanId: planId });
            callbacksRef.current.onBeatCue?.(planId, beatId, cueTimestamp);

            // Let the ink/text mostly appear before the voice cue for this beat.
            const waitMs = beat.action.type === "write" || beat.action.type === "label"
              ? Math.min(Math.max(beat.durationMs, 350), 1_600)
              : Math.min(Math.max(Math.floor(beat.durationMs * 0.55), 160), 600);
            await new Promise((resolve) => window.setTimeout(resolve, waitMs));

            const nextBeat = plan.beats[beatIndex + 1];
            const remaining = plan.beats.length - beatIndex - 1;
            return {
              status: "staged",
              planId,
              beatId,
              voiceCue: beat.voiceCue,
              nextBeatId: nextBeat?.id ?? null,
              remainingBeats: remaining,
              isFinal: !nextBeat,
              continueInstruction: nextBeat
                ? `Speak only this voiceCue, then immediately call stage_ink_beat for nextBeatId=${nextBeat.id}. Do not wait for the learner.`
                : "Speak only this voiceCue. This is the final beat — invite them to try the next problem if the cue does, then stop and listen.",
            };
          },
        });

        const requestInkPlan = tool({
          name: "request_ink_plan",
          description: "Create or resume an authoritative visual plan. Call for new solve/help/check questions, or when the learner says continue. Do not call when the learner says they will try the next problem themselves.",
          parameters: z.object({ question: z.string().trim().min(1).max(800) }),
          timeoutMs: 60_000,
          execute: async ({ question }) => {
            const createPlan = callbacksRef.current.createPlan;
            if (!createPlan) return { status: "unavailable", reason: "plan_author_not_configured" };

            const trimmed = question.trim();
            if (trimmed.length < 4 || /^(um+|uh+|hmm+|ah+|like|so|yeah|ok|okay|hey)\.?$/i.test(trimmed)) {
              return {
                status: "clarify",
                learnerReply: "Which problem should we look at?",
              };
            }

            if (isLearnerTakingATurn(trimmed)) {
              abandonActivePlan();
              return {
                status: "handoff",
                learnerReply: "Perfect — go ahead and work it out on the page. Tell me when you want me to check it.",
              };
            }

            if (planAuthorInFlightRef.current) {
              return { status: "busy", reason: "plan_already_in_flight" };
            }

            const activePlan = activePlanRef.current;
            if (activePlan && isContinueRequest(trimmed)) {
              const remainingBeats = activePlan.beats.filter((beat) => !completedBeatIdsRef.current.has(beat.id));
              if (remainingBeats.length) {
                const resumed = { ...activePlan, beats: remainingBeats };
                activatePlan(resumed);
                return {
                  status: "ready",
                  plan: compactTutorInkPlanForRealtime(resumed),
                  beatCount: remainingBeats.length,
                  continueInstruction: "Resume now. Stage and narrate EVERY remaining beat in this turn without waiting for the learner.",
                };
              }
              abandonActivePlan();
              return {
                status: "handoff",
                learnerReply: "That derivation is done — try the next problem yourself, or point at another one if you want help.",
              };
            }

            // Fresh question: drop any leftover / incomplete plan so we cannot
            // auto-resume or stage stale beats while the new plan authors.
            abandonActivePlan();

            const requestId = ++planRequestRef.current;
            const requestLifecycle = lifecycleRef.current;
            record({ plansRequested: telemetryRef.current.plansRequested + 1 });
            publish({ status: "thinking", error: undefined });
            planAuthorInFlightRef.current = true;
            try {
              const plan = await createPlan(trimmed);
              if (requestLifecycle !== lifecycleRef.current || requestId !== planRequestRef.current) {
                record({ stalePlanResults: telemetryRef.current.stalePlanResults + 1 });
                return { status: "stale", reason: "newer_plan_or_session" };
              }
              activatePlan(plan);
              return {
                status: "ready",
                plan: compactTutorInkPlanForRealtime(plan),
                beatCount: plan.beats.length,
                continueInstruction: "Perform ALL beats now in order in this turn. After each stage_ink_beat, speak its voiceCue, then immediately continue until isFinal.",
              };
            } catch (error) {
              if (requestLifecycle !== lifecycleRef.current || requestId !== planRequestRef.current) {
                record({ stalePlanResults: telemetryRef.current.stalePlanResults + 1 });
                return { status: "stale", reason: "newer_plan_or_session" };
              }
              const message = getErrorMessage(error);
              publish({ status: "ready", error: message });
              return { status: "clarify", learnerReply: "Which problem on this page should we start with?" };
            } finally {
              planAuthorInFlightRef.current = false;
            }
          },
        });

        const agent = new RealtimeAgent({
          name: "studydeck tutor",
          instructions: buildRealtimePerformanceInstructions(payload.instructions),
          voice: "marin",
          tools: [requestInkPlan, stageInkBeat],
        });
        const session = new RealtimeSession(agent, {
          model: payload.model,
          config: {
            outputModalities: ["audio"],
            parallelToolCalls: false,
            audio: {
              input: {
                transcription: { model: "gpt-4o-mini-transcribe" },
                turnDetection: {
                  type: "semantic_vad",
                  eagerness: "auto",
                  interruptResponse: true,
                  createResponse: true,
                },
              },
              output: { voice: "marin" },
            },
          },
        });

        session.on("audio_start", () => {
          if (sessionRef.current !== session) return;
          clearAutoContinue();
          publish({ status: "speaking" });
        });
        session.on("audio_stopped", () => {
          if (sessionRef.current !== session) return;
          publish({ status: "ready" });
        });
        session.on("audio_interrupted", () => {
          if (sessionRef.current !== session) return;
          const planId = speakingPlanIdRef.current;
          record({ interruptions: telemetryRef.current.interruptions + 1 });
          abandonActivePlan(planId);
          publish({ status: "interrupted" });
          callbacksRef.current.onInterrupted?.({ planId, timestamp: now() });
        });
        session.on("agent_start", () => {
          if (sessionRef.current === session) {
            clearAutoContinue();
            publish({ status: "thinking" });
          }
        });
        session.on("agent_end", (_context, _agent, output) => {
          if (sessionRef.current !== session) return;
          if (output.trim()) callbacksRef.current.onTranscript?.({ direction: "tutor", text: output, final: true, timestamp: now() });
          publish({ status: "ready" });
          scheduleAutoContinue(session);
        });
        session.on("transport_event", (event) => {
          if (sessionRef.current !== session) return;
          if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
            clearAutoContinue();
            callbacksRef.current.onTranscript?.({ direction: "learner", text: event.transcript, final: true, timestamp: now() });
          }
        });
        session.on("error", (event) => {
          if (sessionRef.current !== session) return;
          console.error("[studydeck] notebook realtime session error", event);
          abandonActivePlan();
          try { session.close(); } catch { /* already closed */ }
          sessionRef.current = null;
          publish({ status: "error", error: "Voice connection lost. Start the session again.", connected: false });
        });

        let connectTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            session.connect({ apiKey: payload.value }),
            new Promise<never>((_, reject) => {
              connectTimeout = setTimeout(() => reject(new Error("Microphone permission or the voice connection timed out.")), 15_000);
            }),
          ]);
        } finally {
          if (connectTimeout) clearTimeout(connectTimeout);
        }
        if (lifecycle !== lifecycleRef.current) {
          session.close();
          return;
        }
        sessionRef.current = session;
        publish({ status: "ready", connected: true, muted: session.muted ?? false, model: payload.model, sessionId: payload.sessionId });
      } catch (error) {
        if (lifecycle !== lifecycleRef.current) return;
        publish({ status: "error", connected: false, error: getErrorMessage(error) });
        throw error;
      } finally {
        connectPromiseRef.current = null;
      }
    })();
    connectPromiseRef.current = connecting;
    return connecting;
  }, [abandonActivePlan, activatePlan, clearAutoContinue, publish, record, scheduleAutoContinue]);

  const disconnect = useCallback(() => {
    lifecycleRef.current += 1;
    planRequestRef.current += 1;
    connectPromiseRef.current = null;
    clearAutoContinue();
    const session = sessionRef.current;
    sessionRef.current = null;
    try { session?.close(); } catch { /* ignore */ }
    activePlanRef.current = null;
    speakingPlanIdRef.current = undefined;
    completedBeatIdsRef.current = new Set();
    autoContinueCountRef.current = 0;
    publish({ ...initialState });
  }, [clearAutoContinue, publish]);

  const startPlan = useCallback(async (plan: TutorInkPlan) => {
    await connect();
    const session = sessionRef.current;
    if (!session) throw new Error("Voice disconnected before the explanation could start.");
    activatePlan(plan);
    session.sendMessage([
      "An authoritative visual plan has been staged for this turn.",
      `It has ${plan.beats.length} beats. Finish EVERY beat in this turn — do not stop after one step.`,
      "For each beat: call stage_ink_beat, speak only that voiceCue, then immediately continue with nextBeatId until isFinal.",
      JSON.stringify(compactTutorInkPlanForRealtime(plan)),
    ].join("\n"));
  }, [activatePlan, connect]);

  const mute = useCallback(() => {
    sessionRef.current?.mute(true);
    publish({ muted: true });
  }, [publish]);

  const unmute = useCallback(() => {
    sessionRef.current?.mute(false);
    publish({ muted: false });
  }, [publish]);

  const interrupt = useCallback(() => {
    const planId = speakingPlanIdRef.current ?? activePlanRef.current?.id;
    sessionRef.current?.interrupt();
    abandonActivePlan(planId);
    publish({ status: "interrupted" });
  }, [abandonActivePlan, publish]);

  useEffect(() => disconnect, [disconnect]);

  return { state, telemetry, connect, disconnect, startPlan, mute, unmute, interrupt };
}
