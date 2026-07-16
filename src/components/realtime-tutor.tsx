"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { tool } from "@openai/agents";
import { Radio, Square } from "lucide-react";

import type {
  LectureDeck,
  TeachingFormat,
} from "@/lib/aiprof-types";
import type { WhiteboardCanvasAction } from "@/lib/whiteboard-types";
import type { WhiteboardTldrawHandle } from "@/components/whiteboard-tldraw";
import {
  boundSemanticShapes,
  hasExplicitVisualIntent,
  resolveSlideIndex,
  searchCourseMaterial,
  tutorToolNames,
  tutorToolSchemas,
} from "@/lib/tutor-tools";
import {
  buildRealtimeTutorInstructions,
  latestRealtimeUserTranscript,
  OPENAI_REALTIME_MODEL,
  realtimeMessageTranscript,
} from "@/lib/realtime-tutor-context";

type RealtimeTutorProps = {
  deck: LectureDeck;
  sessionId?: string;
  currentSlideIndex: number;
  teachingFormat: TeachingFormat;
  customInstructions: string;
  canvasRef?: React.RefObject<WhiteboardTldrawHandle | null>;
  onActivate?: () => void;
  realtimeEnabled?: boolean;
  connectRequest?: number;
  onStateChange?: (state: RealtimeTutorState) => void;
  onFallback?: () => void;
  onResumeLecture?: (options?: { advance?: boolean }) => void;
  onFocus?: (focus: "slides" | "split" | "whiteboard") => void;
  onPoint?: (point: { x: number; y: number; label: string }) => void;
  onJumpToSlide?: (slideIndex: number) => void;
  onArtifact?: (artifact: { id: string; status: string; url?: string; specUrl?: string; engine?: string; kind?: string }) => void;
};

export type RealtimeTutorState = "idle" | "connecting" | "connected" | "speaking" | "working" | "error";

export function isRealtimeActive(state: RealtimeTutorState) {
  return state === "connected" || state === "speaking" || state === "working";
}

export function RealtimeTutor({
  deck,
  sessionId,
  currentSlideIndex,
  teachingFormat,
  customInstructions,
  canvasRef,
  onActivate,
  realtimeEnabled = true,
  connectRequest,
  onStateChange,
  onFallback,
  onResumeLecture,
  onFocus,
  onPoint,
  onJumpToSlide,
  onArtifact,
}: RealtimeTutorProps) {
  const [state, setState] = useState<RealtimeTutorState>("idle");
  const [error, setError] = useState("");
  const sessionRef = useRef<RealtimeSession | null>(null);
  const connectRef = useRef<() => Promise<void>>(async () => undefined);
  const connectRequestRef = useRef(0);
  const learnerContextRef = useRef("");
  const latestUserTranscriptRef = useRef("");
  const lastSentSlideImageRef = useRef("");
  const connectingRef = useRef(false);
  const connectGenerationRef = useRef(0);
  const connectAbortRef = useRef<AbortController | null>(null);
  const intentionalCloseRef = useRef(false);
  const handoffOfferedRef = useRef(false);
  const contextRef = useRef({
    deck,
    sessionId,
    currentSlideIndex,
    teachingFormat,
    customInstructions,
  });

  useEffect(() => {
    contextRef.current = {
      deck,
      sessionId,
      currentSlideIndex,
      teachingFormat,
      customInstructions,
    };
  }, [deck, sessionId, currentSlideIndex, teachingFormat, customInstructions]);

  const tools = useMemo(() => {
    const focusTool = tool({
      name: tutorToolNames[0],
      description: "Choose whether the student should look at the slides, board, or both.",
      parameters: tutorToolSchemas.set_teaching_focus,
      timeoutMs: 3_000,
      execute: async ({ mode }) => {
        onFocus?.(mode);
        return { ok: true, focus: mode };
      },
    });

    const pointTool = tool({
      name: tutorToolNames[2],
      description: "Point to a precise location on the current slide while explaining it.",
      parameters: tutorToolSchemas.point_to_slide,
      timeoutMs: 3_000,
      execute: async ({ slideIndex, x, y, label }) => {
        const requestedSlide = slideIndex ?? contextRef.current.currentSlideIndex;
        const targetSlide = resolveSlideIndex(contextRef.current.deck, requestedSlide, latestUserTranscriptRef.current);
        if (targetSlide >= contextRef.current.deck.slides.length) {
          return { ok: false, error: "Slide is outside the deck." };
        }
        if (targetSlide !== contextRef.current.currentSlideIndex) onJumpToSlide?.(targetSlide);
        onPoint?.({ x, y, label });
        return { ok: true, slideIndex: targetSlide, x, y, label };
      },
    });

    const navigateTool = tool({
      name: tutorToolNames[1],
      description: "Move to a relevant slide. slideIndex is zero-based; visible page 3 is slideIndex 2. Use the learner's visible page number mapping and never add one.",
      parameters: tutorToolSchemas.navigate_slide,
      timeoutMs: 3_000,
      execute: async ({ slideIndex }) => {
        const totalSlides = contextRef.current.deck.slides.length;
        const targetSlide = resolveSlideIndex(contextRef.current.deck, slideIndex, latestUserTranscriptRef.current);
        if (targetSlide >= totalSlides) return { ok: false, error: "Slide is outside the deck." };
        onJumpToSlide?.(targetSlide);
        return { ok: true, slideIndex: targetSlide, pageNumber: contextRef.current.deck.slides[targetSlide]?.slideNumber };
      },
    });

    const readBoardTool = tool({
      name: tutorToolNames[3],
      description: "Read the current semantic tldraw shapes before correcting or extending the board.",
      parameters: tutorToolSchemas.read_whiteboard,
      timeoutMs: 10_000,
      execute: async ({ includeImage, sinceVersion }) => {
        const shapes = boundSemanticShapes(canvasRef?.current?.getSemanticShapes() ?? []);
        const diff = canvasRef?.current?.getSemanticDiff(sinceVersion);
        const image = includeImage ? await canvasRef?.current?.getBoardImage() : undefined;
        if (image) sessionRef.current?.addImage(image, { triggerResponse: false });
        const version = canvasRef?.current?.getVersion() ?? 0;
        return {
          version,
          shapes,
          diff: diff ? {
            version: diff.version,
            reset: diff.reset,
            created: boundSemanticShapes(diff.created, 60),
            updated: boundSemanticShapes(diff.updated, 60),
            deleted: diff.deleted.slice(0, 60),
          } : undefined,
          imageIncluded: Boolean(image),
          imageUnavailable: Boolean(includeImage && !image),
        };
      },
    });

    const mutateBoardTool = tool({
      name: tutorToolNames[4],
      description: "Apply an idempotent, version-checked transaction of small validated canvas marks. Preserve student work unless asked to replace it.",
      parameters: tutorToolSchemas.mutate_whiteboard,
      timeoutMs: 5_000,
      execute: async ({ transactionId, baseVersion, ops, explanation, presentation }) => {
        await canvasRef?.current?.whenReady();
        const result = canvasRef?.current?.applyTransaction({
          transactionId,
          baseVersion,
          ops: ops as WhiteboardCanvasAction[],
        });
        if (!result?.ok) {
          return {
            ok: false,
            error: result?.error ?? "The board transaction could not be applied.",
            code: result?.code,
            currentVersion: result?.currentVersion,
          };
        }
        onFocus?.(presentation === "whiteboard" ? "whiteboard" : "split");
        return {
          ok: true,
          applied: ops.length,
          currentVersion: canvasRef?.current?.getVersion() ?? baseVersion + 1,
          explanation: explanation ?? "Board updated.",
        };
      },
    });

    const searchTool = tool({
      name: tutorToolNames[5],
      description: "Find relevant slides in the uploaded deck before answering a cross-slide question.",
      parameters: tutorToolSchemas.search_course_material,
      timeoutMs: 5_000,
      execute: async ({ query, limit }) => {
        const results = searchCourseMaterial(contextRef.current.deck, query, limit ?? 3);
        return { query, results };
      },
    });

    const explainTool = tool({
      name: tutorToolNames[6],
      description: "Create a short visual explainer only when the student explicitly asks to see an animation or visual proof.",
      parameters: tutorToolSchemas.create_micro_explainer,
      timeoutMs: 20_000,
      execute: async ({ question, concept, goal, durationSec, visualStyle }) => {
        const context = contextRef.current;
        const learnerRequest = latestUserTranscriptRef.current;
        if (!hasExplicitVisualIntent(learnerRequest)) {
          return { ok: false, error: "A visual explainer requires an explicit learner request." };
        }
        const response = await fetch("/api/render-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: context.sessionId,
            learnerRequest,
            question,
            concept,
            goal,
            durationSec,
            visualStyle: visualStyle ?? "clean",
            slide: context.deck.slides[context.currentSlideIndex],
            deckTitle: context.deck.deckTitle,
            courseName: context.deck.courseName,
          }),
          signal: AbortSignal.timeout(18_000),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          jobId?: string;
          status?: string;
          url?: string;
          engine?: string;
          kind?: string;
          error?: string;
        };
        if (!response.ok || !payload.jobId) {
          return { ok: false, error: payload.error ?? "Explainer request failed." };
        }
        onArtifact?.({ id: payload.jobId, status: payload.status ?? "queued", url: payload.url, specUrl: `/api/render-jobs/${payload.jobId}/spec`, engine: payload.engine, kind: payload.kind });
        return { ok: true, jobId: payload.jobId, status: payload.status ?? "queued", url: payload.url, specUrl: `/api/render-jobs/${payload.jobId}/spec`, engine: payload.engine, kind: payload.kind };
      },
    });

    const learningSignalTool = tool({
      name: tutorToolNames[7],
      description: "Record evidence of what the learner understood or misunderstood after a teach-back, example, or correction.",
      parameters: tutorToolSchemas.record_learning_signal,
      timeoutMs: 12_000,
      execute: async ({ concept, outcome, evidence, misconception, preferredExplanationStyle }) => {
        const response = await fetch("/api/learning/signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: contextRef.current.sessionId,
            concept,
            outcome,
            evidence,
            misconception,
            preferredExplanationStyle,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          conceptState?: { masteryScore?: number };
          reviewItem?: { dueAt?: string };
          error?: string;
        };
        if (!response.ok) return { ok: false, error: payload.error ?? "Could not save learning signal." };
        return {
          ok: true,
          concept,
          outcome,
          masteryScore: payload.conceptState?.masteryScore,
          nextReviewAt: payload.reviewItem?.dueAt,
        };
      },
    });

    return [focusTool, pointTool, navigateTool, readBoardTool, mutateBoardTool, searchTool, explainTool, learningSignalTool];
  }, [canvasRef, onArtifact, onFocus, onJumpToSlide, onPoint]);

  async function connect() {
    if (connectingRef.current) {
      connectGenerationRef.current += 1;
      connectAbortRef.current?.abort();
      connectAbortRef.current = null;
      connectingRef.current = false;
      setState("idle");
      return;
    }
    if (sessionRef.current) {
      intentionalCloseRef.current = true;
      sessionRef.current.close();
      sessionRef.current = null;
      lastSentSlideImageRef.current = "";
      setState("idle");
      queueMicrotask(() => { intentionalCloseRef.current = false; });
      return;
    }

    const generation = connectGenerationRef.current + 1;
    connectGenerationRef.current = generation;
    connectingRef.current = true;
    const controller = new AbortController();
    connectAbortRef.current = controller;
    setError("");
    setState("connecting");
    onActivate?.();

    const context = contextRef.current;
    const slide = context.deck.slides[context.currentSlideIndex];
    if (!context.sessionId) {
      connectingRef.current = false;
      connectAbortRef.current = null;
      setError("A saved study session is required for the realtime tutor.");
      setState("error");
      onFallback?.();
      return;
    }
    const persistEvent = (event: {
      kind: string;
      role: string;
      modality: string;
      transcript?: string;
      payload?: unknown;
    }) => {
      const current = contextRef.current;
      if (!current.sessionId) return;
      void fetch(`/api/sessions/${current.sessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...event,
          clientEventId: crypto.randomUUID(),
          slideIndex: current.currentSlideIndex,
          relativeTimeMs: Math.round(performance.now()),
        }),
      }).catch(() => undefined);
    };
    let session: RealtimeSession | null = null;
    try {
      const tokenTimeout = window.setTimeout(() => controller.abort(), 15_000);
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: context.sessionId,
          currentSlideIndex: context.currentSlideIndex,
        }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(tokenTimeout));
      const payload = (await response.json().catch(() => ({}))) as {
        value?: string;
        instructions?: string;
        learnerContext?: string;
        model?: string;
        error?: string;
      };
      if (!response.ok || !payload.value || !payload.instructions) {
        throw new Error(payload.error ?? "Realtime tutoring is unavailable.");
      }
      learnerContextRef.current = payload.learnerContext ?? "";

      const agent = new RealtimeAgent({
        name: "studydeck professor",
        voice: "marin",
        instructions: payload.instructions,
        tools,
      });
      session = new RealtimeSession(agent, {
        model: payload.model ?? OPENAI_REALTIME_MODEL,
        context: context.deck,
        groupId: context.sessionId,
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
      session.on("agent_start", () => {
        setState("connected");
        persistEvent({ kind: "realtime_agent_start", role: "assistant", modality: "audio" });
      });
      session.on("audio_start", () => setState("speaking"));
      session.on("audio_stopped", () => setState("connected"));
      session.on("audio_interrupted", () => {
        setState("connected");
        persistEvent({ kind: "realtime_interrupt", role: "system", modality: "audio" });
      });
      const persistedHistoryItems = new Set<string>();
      session.on("history_updated", (history) => {
        latestUserTranscriptRef.current = latestRealtimeUserTranscript(history);
        for (const item of history) {
          const summary = realtimeMessageTranscript(item);
          if (!summary || (summary.itemId && persistedHistoryItems.has(summary.itemId))) continue;
          if (summary.itemId) {
            persistedHistoryItems.add(summary.itemId);
            persistEvent({
              kind: "realtime_transcript",
              role: summary.role,
              modality: "audio",
              transcript: summary.transcript,
            });
          }
          const normalized = summary.transcript.toLowerCase();
          if (summary.role === "assistant" && /\b(next slide|next page|next topic|continue the lecture|move on|resume)\b/.test(normalized)) {
            handoffOfferedRef.current = true;
          }
          if (summary.role === "user" && shouldResumeScriptedLecture(normalized, handoffOfferedRef.current)) {
            handoffOfferedRef.current = false;
            intentionalCloseRef.current = true;
            session?.close();
            sessionRef.current = null;
            lastSentSlideImageRef.current = "";
            setState("idle");
            onResumeLecture?.({ advance: /\b(next slide|next page|next topic|move to the next)\b/.test(normalized) });
            queueMicrotask(() => { intentionalCloseRef.current = false; });
            break;
          }
        }
      });
      session.on("agent_tool_start", (_context, _agent, toolCall) => {
        setState("working");
        persistEvent({
          kind: "realtime_tool_start",
          role: "assistant",
          modality: "tool",
          payload: { name: toolCall.name },
        });
      });
      session.on("agent_tool_end", (_context, _agent, toolCall, result) => {
        setState("connected");
        const serializedResult = typeof result === "string" ? result : JSON.stringify(result);
        persistEvent({
          kind: "realtime_tool_call",
          role: "assistant",
          modality: "tool",
          payload: { name: toolCall.name, result: serializedResult?.slice(0, 4000) },
        });
      });
      session.on("error", (event) => {
        if (intentionalCloseRef.current) return;
        console.error("[studydeck] realtime session error", event);
        session?.close();
        if (sessionRef.current === session) sessionRef.current = null;
        lastSentSlideImageRef.current = "";
        setError("Realtime connection lost. You can continue with the regular tutor.");
        setState("error");
      });
      await session.connect({ apiKey: payload.value });
      if (connectGenerationRef.current !== generation) {
        session.close();
        return;
      }
      sessionRef.current = session;
      setState("connected");

      if (slide?.imageUrl) {
        lastSentSlideImageRef.current = `${context.currentSlideIndex}:${slide.imageUrl}`;
        void addImageToSession(session, slide.imageUrl);
      }
    } catch (error) {
      session?.close();
      if (sessionRef.current === session) sessionRef.current = null;
      lastSentSlideImageRef.current = "";
      if (connectGenerationRef.current !== generation) return;
      console.error("[studydeck] realtime connect failed", error);
      setError(controller.signal.aborted
        ? "Realtime connection timed out. Please try again."
        : error instanceof Error ? error.message : "Realtime tutoring is unavailable.");
      setState("error");
      onFallback?.();
    } finally {
      if (connectGenerationRef.current === generation) {
        connectingRef.current = false;
        connectAbortRef.current = null;
      }
    }
  }

  connectRef.current = connect;

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    if (!connectRequest || connectRequestRef.current === connectRequest) return;
    connectRequestRef.current = connectRequest;
    if (!sessionRef.current) void connectRef.current();
  }, [connectRequest]);

  useEffect(() => {
    if (realtimeEnabled) return;
    connectGenerationRef.current += 1;
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    connectingRef.current = false;
    if (sessionRef.current) {
      intentionalCloseRef.current = true;
      sessionRef.current.close();
      sessionRef.current = null;
      lastSentSlideImageRef.current = "";
      queueMicrotask(() => { intentionalCloseRef.current = false; });
    }
    setState("idle");
  }, [realtimeEnabled]);

  useEffect(() => {
    const session = sessionRef.current;
    const slide = deck.slides[currentSlideIndex];
    if (!session || !slide) return;
    session.transport.updateSessionConfig({
      instructions: buildRealtimeTutorInstructions({
        deck,
        currentSlideIndex,
        teachingFormat,
        customInstructions,
        learnerContext: learnerContextRef.current,
      }),
    });
    const imageKey = `${currentSlideIndex}:${slide.imageUrl}`;
    if (slide.imageUrl && lastSentSlideImageRef.current !== imageKey) {
      lastSentSlideImageRef.current = imageKey;
      void addImageToSession(session, slide.imageUrl);
    }
  }, [customInstructions, deck, currentSlideIndex, teachingFormat]);

  useEffect(() => {
    return () => {
      connectGenerationRef.current += 1;
      connectAbortRef.current?.abort();
      sessionRef.current?.close();
      sessionRef.current = null;
      lastSentSlideImageRef.current = "";
    };
  }, []);

  const active = isRealtimeActive(state);
  const label = state === "connecting"
    ? "Connecting..."
    : state === "speaking"
      ? "Professor speaking"
      : state === "working"
        ? "Using a tool..."
        : active
          ? "Realtime listening"
          : "Realtime tutor";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void connect()}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition"
        style={{
          background: active ? "rgba(74,222,128,0.14)" : "rgba(77,158,248,0.16)",
          color: active ? "#86efac" : "#93c5fd",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
        aria-label={active ? "Stop realtime tutor" : "Start realtime tutor"}
      >
        {active ? <Square className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
        {label}
      </button>
      {error ? <span className="max-w-[15rem] truncate text-[0.65rem] text-amber-300" title={error}>{error}</span> : null}
    </div>
  );
}

async function addImageToSession(session: RealtimeSession, imageUrl: string) {
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    session.addImage(dataUrl, { triggerResponse: false });
  } catch {
    // Slide text remains available if the image cannot be loaded.
  }
}

function shouldResumeScriptedLecture(transcript: string, handoffOffered: boolean) {
  if (/\b(next slide|next page|next topic|continue (the )?lecture|resume (the )?lecture|move to the next)\b/.test(transcript)) return true;
  return handoffOffered && /^(yes|yeah|yep|okay|ok|sure|do it|let's|lets|go ahead)\b/.test(transcript.trim());
}
