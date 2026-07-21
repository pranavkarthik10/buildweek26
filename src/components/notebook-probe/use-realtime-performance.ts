"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";

import { PcmAudioPlayer } from "@/lib/live-audio";
import {
  buildAckPlan,
  classifyTutorIntent,
  isContinueRequest,
  isEchoOfTutorCue,
  isLearnerTakingATurn,
  shouldPreserveTutorInk,
  type TutorTurnIntent,
} from "@/lib/notebook-tutor-intent";
import type { TutorInkPlan } from "./probe-types";

export type RealtimePerformanceStatus = "idle" | "connecting" | "ready" | "thinking" | "speaking" | "interrupted" | "error";

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

export type RealtimeTranscriptEvent = { direction: "learner" | "tutor"; text: string; final: boolean; timestamp: number };
export type RealtimeInterruptedEvent = { planId?: string; timestamp: number };

export type CreateTutorPlanOptions = {
  signal: AbortSignal;
  intent: TutorTurnIntent;
  preserveInk: boolean;
};

export type UseRealtimePerformanceOptions = {
  createPlan?: (question: string, options: CreateTutorPlanOptions) => Promise<TutorInkPlan>;
  /** Board memory: whether tutor ink is already on the canvas. */
  hasTutorInk?: () => boolean;
  hasLearnerInk?: () => boolean;
  onPlanActivated?: (plan: TutorInkPlan, options: { preserveInk: boolean }) => void;
  onBeatCue?: (planId: string, beatId: string, cueTimestamp: number, plan: TutorInkPlan) => boolean;
  onInterrupted?: (event: RealtimeInterruptedEvent) => void;
  onTranscript?: (event: RealtimeTranscriptEvent) => void;
  onState?: (state: RealtimePerformanceState, telemetry: RealtimePerformanceTelemetry) => void;
};

export type RealtimePerformanceController = {
  state: RealtimePerformanceState;
  telemetry: RealtimePerformanceTelemetry;
  connect: () => Promise<void>;
  disconnect: () => void;
  startPlan: (plan: TutorInkPlan) => Promise<void>;
  mute: () => void;
  unmute: () => void;
  interrupt: () => void;
};

type RealtimeSecretResponse = { value?: string; sessionId?: string; model?: string; error?: string };
type SpeechMessage = { type?: "audio" | "done" | "error"; audio?: string; mimeType?: string; sampleRate?: number; error?: string };

const initialState: RealtimePerformanceState = { status: "idle", connected: false, muted: false };
const initialTelemetry: RealtimePerformanceTelemetry = {
  connectionAttempts: 0,
  acceptedBeatCues: 0,
  ignoredBeatCues: 0,
  plansRequested: 0,
  stalePlanResults: 0,
  interruptions: 0,
};

const ECHO_HOLD_MS = 400;

export {
  classifyTutorIntent,
  isContinueRequest,
  isEchoOfTutorCue,
  isLearnerTakingATurn,
  shouldPreserveTutorInk,
};
export type { TutorTurnIntent };

export function buildRealtimePerformanceInstructions(baseInstructions: string) {
  return [
    baseInstructions,
    "This session is transcription-only. Never create an audio or text response.",
    "Never call tools or speak to the learner.",
  ].join("\n");
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function isFiller(text: string) {
  return text.length < 2 || /^(um+|uh+|hmm+|ah+|like|so|hey)\.?$/i.test(text);
}

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
  const requestRef = useRef(0);
  const runRef = useRef(0);
  const planAbortRef = useRef<AbortController | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const audioPlayerRef = useRef(new PcmAudioPlayer());
  const activePlanRef = useRef<TutorInkPlan | null>(null);
  const pausedPlanRef = useRef<{ plan: TutorInkPlan; completed: Set<string> } | null>(null);
  const completedRef = useRef(new Set<string>());
  const lastVoiceCueRef = useRef<string | undefined>(undefined);
  const tutorSpeakingUntilRef = useRef(0);
  const echoHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const markTutorSpeaking = useCallback((cue: string) => {
    lastVoiceCueRef.current = cue;
    if (echoHoldTimerRef.current) {
      clearTimeout(echoHoldTimerRef.current);
      echoHoldTimerRef.current = null;
    }
    tutorSpeakingUntilRef.current = Number.POSITIVE_INFINITY;
  }, []);

  const releaseTutorSpeaking = useCallback((holdMs = ECHO_HOLD_MS) => {
    tutorSpeakingUntilRef.current = now() + holdMs;
    if (echoHoldTimerRef.current) clearTimeout(echoHoldTimerRef.current);
    echoHoldTimerRef.current = setTimeout(() => {
      echoHoldTimerRef.current = null;
      if (tutorSpeakingUntilRef.current <= now()) tutorSpeakingUntilRef.current = 0;
    }, holdMs);
  }, []);

  const isTutorAudioHot = useCallback(() => now() < tutorSpeakingUntilRef.current, []);

  const stopPlayback = useCallback(() => {
    runRef.current += 1;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    audioPlayerRef.current.stop();
    if (echoHoldTimerRef.current) {
      clearTimeout(echoHoldTimerRef.current);
      echoHoldTimerRef.current = null;
    }
    tutorSpeakingUntilRef.current = 0;
  }, []);

  const abandonPlan = useCallback(() => {
    stopPlayback();
    planAbortRef.current?.abort();
    planAbortRef.current = null;
    activePlanRef.current = null;
    pausedPlanRef.current = null;
    completedRef.current = new Set();
    requestRef.current += 1;
    publish({ activePlanId: undefined });
  }, [publish, stopPlayback]);

  const suspendPlan = useCallback(() => {
    const plan = activePlanRef.current;
    stopPlayback();
    if (!plan) return undefined;
    pausedPlanRef.current = { plan, completed: new Set(completedRef.current) };
    activePlanRef.current = null;
    publish({ activePlanId: undefined, status: "interrupted" });
    return plan.id;
  }, [publish, stopPlayback]);

  const activatePlan = useCallback((plan: TutorInkPlan, preserveInk: boolean, completed = new Set<string>()) => {
    stopPlayback();
    activePlanRef.current = plan;
    pausedPlanRef.current = null;
    completedRef.current = new Set(completed);
    publish({ activePlanId: plan.id, status: "thinking", error: undefined });
    callbacksRef.current.onPlanActivated?.(plan, { preserveInk });
  }, [publish, stopPlayback]);

  const playSpeech = useCallback(async (text: string, runId: number) => {
    const controller = new AbortController();
    speechAbortRef.current = controller;
    markTutorSpeaking(text);
    try {
      const response = await fetch("/api/lecture/tts/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ text, voiceName: "Kore", cache: "none" }),
      });
      if (!response.ok || !response.body) throw new Error("Speech is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastPlayback = Promise.resolve();
      let chunks = 0;

      while (runRef.current === runId) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const message = JSON.parse(line || "{}") as SpeechMessage;
          if (message.type === "error") throw new Error(message.error || "Speech is unavailable.");
          if (message.type === "audio" && message.audio) {
            chunks += 1;
            if (chunks === 1) publish({ status: "speaking" });
            lastPlayback = audioPlayerRef.current.queue(message.audio, message.sampleRate ?? 24000, 1.14, message.mimeType);
          }
        }
      }
      if (runRef.current !== runId) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
      await lastPlayback;
      return chunks > 0 && runRef.current === runId;
    } finally {
      if (runRef.current === runId) releaseTutorSpeaking();
      else tutorSpeakingUntilRef.current = 0;
    }
  }, [markTutorSpeaking, publish, releaseTutorSpeaking]);

  const playPlan = useCallback(async (plan: TutorInkPlan) => {
    const runId = ++runRef.current;
    for (const beat of plan.beats) {
      if (runRef.current !== runId || activePlanRef.current?.id !== plan.id) return;
      if (completedRef.current.has(beat.id)) continue;
      let confirmed = false;
      const cueTimestamp = now();
      for (let attempt = 0; attempt < 4 && runRef.current === runId; attempt += 1) {
        confirmed = callbacksRef.current.onBeatCue?.(plan.id, beat.id, cueTimestamp, plan) ?? false;
        if (confirmed) break;
        await new Promise((resolve) => window.setTimeout(resolve, 50 * (attempt + 1)));
      }
      if (!confirmed || runRef.current !== runId) {
        record({ ignoredBeatCues: telemetryRef.current.ignoredBeatCues + 1 });
        publish({ status: "error", error: "The notebook canvas paused. Try the question again." });
        return;
      }
      record({
        acceptedBeatCues: telemetryRef.current.acceptedBeatCues + 1,
        lastCue: { planId: plan.id, beatId: beat.id, timestamp: cueTimestamp },
      });
      try {
        const played = await playSpeech(beat.voiceCue, runId);
        if (!played) return;
      } catch (error) {
        if (runRef.current !== runId || error instanceof DOMException && error.name === "AbortError") return;
        publish({ status: "error", error: "Tutor audio paused. Ask again to resume." });
        return;
      }
      completedRef.current.add(beat.id);
    }
    if (runRef.current === runId) publish({ status: "ready", activePlanId: plan.id });
  }, [playSpeech, publish, record]);

  const authorAndPlay = useCallback(async (question: string, intent: TutorTurnIntent) => {
    const createPlan = callbacksRef.current.createPlan;
    if (!createPlan) return;
    planAbortRef.current?.abort();
    const controller = new AbortController();
    planAbortRef.current = controller;
    const requestId = ++requestRef.current;
    const lifecycle = lifecycleRef.current;
    const preserveInk = shouldPreserveTutorInk(intent);
    record({ plansRequested: telemetryRef.current.plansRequested + 1 });
    publish({ status: "thinking", error: undefined });
    try {
      const plan = await createPlan(question, { signal: controller.signal, intent, preserveInk });
      if (requestId !== requestRef.current || lifecycle !== lifecycleRef.current) {
        record({ stalePlanResults: telemetryRef.current.stalePlanResults + 1 });
        return;
      }
      activatePlan(plan, preserveInk);
      void playPlan(plan);
    } catch {
      if (controller.signal.aborted) return;
      publish({ status: "error", error: "I couldn’t read that problem. Point to it or ask again." });
    } finally {
      if (planAbortRef.current === controller) planAbortRef.current = null;
    }
  }, [activatePlan, playPlan, publish, record]);

  const handleLearnerTurn = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || isFiller(question)) return;

    // Ignore speaker-bleed transcripts while (and briefly after) the tutor is talking.
    if (isTutorAudioHot() && isEchoOfTutorCue(question, lastVoiceCueRef.current)) {
      return;
    }

    // Real learner speech during playback: pause first, then route the turn.
    if (activePlanRef.current && (stateRef.current.status === "speaking" || stateRef.current.status === "thinking")) {
      const planId = suspendPlan();
      if (planId) {
        record({ interruptions: telemetryRef.current.interruptions + 1 });
        callbacksRef.current.onInterrupted?.({ planId, timestamp: now() });
      }
    }

    callbacksRef.current.onTranscript?.({ direction: "learner", text: question, final: true, timestamp: now() });

    const canResume = Boolean(
      (pausedPlanRef.current && pausedPlanRef.current.plan.beats.some((beat) => !pausedPlanRef.current!.completed.has(beat.id)))
      || (activePlanRef.current && activePlanRef.current.beats.some((beat) => !completedRef.current.has(beat.id))),
    );
    const intent = classifyTutorIntent(question, {
      hasTutorInk: Boolean(callbacksRef.current.hasTutorInk?.()),
      hasLearnerInk: Boolean(callbacksRef.current.hasLearnerInk?.()),
      canResume,
    });

    if (intent === "handoff") {
      abandonPlan();
      publish({ status: "ready" });
      return;
    }

    if (intent === "ack") {
      abandonPlan();
      const plan = buildAckPlan();
      activatePlan(plan, true);
      void playPlan(plan);
      return;
    }

    if (intent === "resume") {
      const resumable = pausedPlanRef.current ?? (activePlanRef.current ? { plan: activePlanRef.current, completed: completedRef.current } : null);
      if (resumable) {
        const remaining = resumable.plan.beats.filter((beat) => !resumable.completed.has(beat.id));
        if (remaining.length) {
          activatePlan(resumable.plan, true, resumable.completed);
          void playPlan(resumable.plan);
          return;
        }
      }
    }

    abandonPlan();
    await authorAndPlay(question, intent);
  }, [abandonPlan, activatePlan, authorAndPlay, isTutorAudioHot, playPlan, publish, record, suspendPlan]);

  const connect = useCallback(async () => {
    if (sessionRef.current) return;
    if (connectPromiseRef.current) return connectPromiseRef.current;
    const lifecycle = ++lifecycleRef.current;
    record({ connectionAttempts: telemetryRef.current.connectionAttempts + 1 });
    publish({ status: "connecting", error: undefined });
    const connecting = (async () => {
      try {
        await audioPlayerRef.current.unlock().catch(() => undefined);
        const response = await fetch("/api/notebook/probe/realtime", { method: "POST" });
        const payload = await response.json().catch(() => ({})) as RealtimeSecretResponse;
        if (!response.ok || !payload.value || !payload.model) throw new Error("Voice is not available right now.");
        const agent = new RealtimeAgent({
          name: "studydeck listener",
          instructions: buildRealtimePerformanceInstructions("Transcribe the learner only."),
          tools: [],
        });
        const session = new RealtimeSession(agent, {
          model: payload.model,
          config: {
            outputModalities: ["audio"],
            audio: {
              input: {
                transcription: { model: "gpt-4o-mini-transcribe" },
                turnDetection: { type: "semantic_vad", eagerness: "medium", interruptResponse: false, createResponse: false },
              },
              output: { voice: "marin" },
            },
          },
        });
        session.on("transport_event", (event) => {
          if (sessionRef.current !== session) return;
          // Do not suspend on raw VAD — speaker echo triggers speech_started.
          // Barge-in happens when a real (non-echo) transcript arrives.
          if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
            void handleLearnerTurn(event.transcript);
          }
        });
        session.on("error", (event) => {
          if (sessionRef.current !== session) return;
          console.error("[studydeck] notebook listener error", event);
          sessionRef.current = null;
          stopPlayback();
          publish({ status: "error", connected: false, error: "Voice connection lost. Start the session again." });
        });
        await session.connect({ apiKey: payload.value });
        if (lifecycle !== lifecycleRef.current) return session.close();
        sessionRef.current = session;
        publish({ status: "ready", connected: true, muted: session.muted ?? false, model: payload.model, sessionId: payload.sessionId });
      } catch (error) {
        if (lifecycle !== lifecycleRef.current) return;
        publish({ status: "error", connected: false, error: error instanceof Error ? error.message : "Voice couldn’t connect." });
        throw error;
      } finally {
        connectPromiseRef.current = null;
      }
    })();
    connectPromiseRef.current = connecting;
    return connecting;
  }, [handleLearnerTurn, publish, record, stopPlayback]);

  const disconnect = useCallback(() => {
    lifecycleRef.current += 1;
    connectPromiseRef.current = null;
    abandonPlan();
    const session = sessionRef.current;
    sessionRef.current = null;
    try { session?.close(); } catch { /* already closed */ }
    publish({ ...initialState });
  }, [abandonPlan, publish]);

  const startPlan = useCallback(async (plan: TutorInkPlan) => {
    await connect();
    activatePlan(plan, false);
    void playPlan(plan);
  }, [activatePlan, connect, playPlan]);

  const mute = useCallback(() => { sessionRef.current?.mute(true); publish({ muted: true }); }, [publish]);
  const unmute = useCallback(() => { sessionRef.current?.mute(false); publish({ muted: false }); }, [publish]);
  const interrupt = useCallback(() => {
    const planId = suspendPlan();
    if (planId) {
      record({ interruptions: telemetryRef.current.interruptions + 1 });
      callbacksRef.current.onInterrupted?.({ planId, timestamp: now() });
    }
  }, [record, suspendPlan]);

  useEffect(() => () => {
    disconnect();
    void audioPlayerRef.current.close();
  }, [disconnect]);

  return { state, telemetry, connect, disconnect, startPlan, mute, unmute, interrupt };
}
