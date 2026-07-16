"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type {
  LectureBeat,
  LectureDeck,
  LectureSegment,
  LectureSlide,
  TeachingFormat,
  TutorSource,
  WhiteboardContent,
  WhiteboardMode,
} from "@/lib/aiprof-types";
import { runWhiteboardSession } from "@/lib/run-whiteboard-session";
import type {
  TeachingFocus,
} from "@/lib/whiteboard-types";
import type { TutorBoardContext, TutorEffect } from "@/lib/tutor-tools";

import { LectureWorkspace } from "@/components/lecture-workspace";
import type { RealtimeTutorState } from "@/components/realtime-tutor";
import type { WhiteboardTldrawHandle } from "@/components/whiteboard-tldraw";
import { PcmAudioPlayer } from "@/lib/live-audio";

const DEFAULT_SPEECH_SPEED = 1.03;
const SEGMENT_PREFETCH_AHEAD = 2;

type StreamSpeechMessage = {
  type?: "audio" | "done" | "error";
  audio?: string;
  mimeType?: string;
  sampleRate?: number;
  durationMs?: number;
  retryAfterMs?: number;
  error?: string;
};

type SpeechStreamResult = {
  response?: Response;
  error?: string;
  retryAfterMs?: number;
};

type SpeechPlaybackResult = {
  ok: boolean;
  stopped?: boolean;
  error?: string;
  retryAfterMs?: number;
};

type LectureStudioProps = {
  lectureDeck: LectureDeck;
  initialSlideIndex?: number;
  initialCueIndex?: number;
  initialTeachingFormat?: TeachingFormat;
  initialCustomInstructions?: string;
  initialBoardSnapshot?: string;
  initialBoardVersion?: number;
  autoStart?: boolean;
  sessionId?: string;
  onSlideChange?: (slideIndex: number, cueIndex: number) => void;
  onEndSession?: () => void;
};

type StartLectureOptions = {
  automatic?: boolean;
};

export function LectureStudio({
  lectureDeck,
  initialSlideIndex = 0,
  initialCueIndex = 0,
  initialTeachingFormat = "lecture",
  initialCustomInstructions = "",
  initialBoardSnapshot,
  initialBoardVersion = 0,
  autoStart = false,
  sessionId,
  onSlideChange,
  onEndSession,
}: LectureStudioProps) {
  const [isLive, setIsLive] = useState(false);
  const [isAutoStarting, setIsAutoStarting] = useState(autoStart);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(initialSlideIndex);
  const [currentCueIndex, setCurrentCueIndex] = useState(initialCueIndex);
  const [isAnswering, setIsAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checkpointQuestion, setCheckpointQuestion] = useState("");
  const [answerSources, setAnswerSources] = useState<TutorSource[]>([]);
  const [questionError, setQuestionError] = useState("");
  const [liveStatus, setLiveStatus] = useState("idle");
  const [liveError, setLiveError] = useState("");
  const [realtimeConnectRequest, setRealtimeConnectRequest] = useState(0);
  const [realtimeState, setRealtimeState] = useState<RealtimeTutorState>("idle");
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [speechSpeed, setSpeechSpeed] = useState(DEFAULT_SPEECH_SPEED);
  const [teachingFormat, setTeachingFormat] = useState<TeachingFormat>(
    initialTeachingFormat
  );
  const [customInstructions, setCustomInstructions] = useState(
    initialCustomInstructions
  );
  const [isSpeakingAnswer, setIsSpeakingAnswer] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const boardSnapshotRef = useRef(initialBoardSnapshot);
  const boardSemanticRef = useRef<TutorBoardContext>({ version: initialBoardVersion, shapes: [] });
  const boardSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardSaveAbortRef = useRef<AbortController | null>(null);
  const [whiteboardContent, setWhiteboardContent] = useState<WhiteboardContent>({
    mode: "canvas",
    title: "Whiteboard",
    tldrawSnapshot: initialBoardSnapshot,
  });
  const [teachingFocus, setTeachingFocus] = useState<TeachingFocus>("slides");
  const [whiteboardStatus, setWhiteboardStatus] = useState<string | undefined>();
  const canvasRef = useRef<WhiteboardTldrawHandle | null>(null);
  const whiteboardAbortRef = useRef<AbortController | null>(null);
  const whiteboardTriggeredRef = useRef(false);
  const [liveCue, setLiveCue] = useState<{
    id: string;
    label: string;
    emphasis: string;
    x: number;
    y: number;
    targetBullet: number;
  } | null>(null);
  const audioPlayerRef = useRef<PcmAudioPlayer | null>(null);

  useEffect(() => {
    if (!activeArtifactId) return;
    let cancelled = false;

    async function pollArtifact() {
      try {
        const response = await fetch(`/api/render-jobs/${activeArtifactId}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const artifact = (await response.json()) as {
          status?: WhiteboardContent["explainerStatus"];
          id?: string;
          engine?: string;
          kind?: string;
          artifactUrl?: string | null;
          specUrl?: string | null;
          url?: string | null;
          error?: string | null;
        };
        if (cancelled || !artifact.status) return;
        if (artifact.id && artifact.engine) {
          await canvasRef.current?.whenReady();
          canvasRef.current?.insertVisualArtifact({ id: artifact.id, engine: artifact.engine, status: artifact.status, artifactUrl: artifact.artifactUrl ?? artifact.url ?? undefined, specUrl: artifact.specUrl ?? artifact.url ?? undefined });
        }
        setWhiteboardStatus(
          artifact.status === "completed"
            ? "Visual explainer ready"
            : artifact.status === "failed"
              ? "Visual rendering failed; the live board is still available."
              : `Rendering visual... ${artifact.status}`,
        );
        if (["completed", "failed"].includes(artifact.status)) setActiveArtifactId(null);
      } catch {
        // Keep the inline preview available if the status endpoint is offline.
      }
    }

    void pollArtifact();
    const timer = window.setInterval(() => void pollArtifact(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeArtifactId]);
  const lectureRunRef = useRef(0);
  const answerRunRef = useRef(0);
  const speechSpeedRef = useRef(DEFAULT_SPEECH_SPEED);
  const resumeSlideIndexRef = useRef<number | null>(null);
  const audioPausedRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);
  const startLectureRef = useRef<
    (options?: StartLectureOptions) => Promise<void>
  >(async () => undefined);
  const segmentCacheRef = useRef(new Map<string, Promise<LectureSegment>>());
  const speechWarmupCacheRef = useRef(new Map<string, Promise<SpeechStreamResult> | null>());

  const activeSlide = lectureDeck?.slides[currentSlideIndex] ?? null;
  const activeCue = isLive ? liveCue : activeSlide?.cues[currentCueIndex] ?? null;

  // Notify parent of slide changes for session persistence
  useEffect(() => {
    onSlideChange?.(currentSlideIndex, currentCueIndex);
  }, [currentSlideIndex, currentCueIndex, onSlideChange]);

  useEffect(() => {
    if (!autoStart || autoStartAttemptedRef.current) return;

    autoStartAttemptedRef.current = true;
    // Browsers require a user gesture before AudioContext.resume(). Attempting
    // to unlock here can leave the entire session on a permanent loading
    // screen because the promise is allowed to remain pending.
    if (navigator.userActivation?.isActive) {
      void startLectureRef.current({ automatic: true });
      return;
    }
    setIsAutoStarting(false);
    setLiveStatus("idle");
    setLiveError("Resume the lecture to enable audio, or start the realtime tutor after entering the studio.");
  }, [autoStart]);

  async function startLecture(options?: StartLectureOptions) {
    if (!lectureDeck) return;

    try {
      setIsAutoStarting(Boolean(options?.automatic));
      setLiveStatus("starting");
      audioPlayerRef.current ??= new PcmAudioPlayer();
      audioPlayerRef.current.setPlaybackRate(speechSpeedRef.current);
      const audioReady = await settleWithin(audioPlayerRef.current.unlock(), 3_000);
      setIsAutoStarting(false);
      setIsLive(true);
      setIsAudioPaused(false);
      audioPausedRef.current = false;
      setIsAnswering(false);
      setAnswer("");
      setCheckpointQuestion("");
      setAnswerSources([]);
      setLiveError(audioReady
        ? ""
        : "Scripted audio is blocked in this browser. Text questions and the enhanced realtime tutor are still available.");
      if (audioReady) {
        prewarmLectureWindow(lectureDeck, currentSlideIndex);
        void runScriptedLecture(lectureDeck, currentSlideIndex);
      } else {
        setLiveStatus("paused");
      }
    } catch (error) {
      setIsAutoStarting(false);
      setLiveStatus("idle");
      setLiveError(
        options?.automatic
          ? "Start lecture to enable audio."
          : error instanceof Error
            ? error.message
            : "Failed to start lecture.",
      );
    }
  }

  startLectureRef.current = startLecture;

  function jumpToSlide(index: number, options?: { resumeLecture?: boolean }) {
    if (!lectureDeck) return;

    stopLectureRun();
    setCurrentSlideIndex(index);
    setCurrentCueIndex(0);
    setLiveCue(null);

    if (options?.resumeLecture !== false && isLive && !isAnswering) {
      void runScriptedLecture(lectureDeck, index);
    }
  }

  function nextCue() {
    if (!lectureDeck || !activeSlide) return;

    if (isLive) {
      const nextIndex = Math.min(
        currentSlideIndex + 1,
        lectureDeck.slides.length - 1
      );
      jumpToSlide(nextIndex);
      return;
    }

    if (currentCueIndex < activeSlide.cues.length - 1) {
      setCurrentCueIndex((c) => c + 1);
      return;
    }

    if (currentSlideIndex < lectureDeck.slides.length - 1) {
      setCurrentSlideIndex((c) => c + 1);
      setCurrentCueIndex(0);
    }
  }

  function prevCue() {
    if (!lectureDeck) return;

    if (isLive) {
      const previousIndex = Math.max(currentSlideIndex - 1, 0);
      jumpToSlide(previousIndex);
      return;
    }

    if (currentCueIndex > 0) {
      setCurrentCueIndex((c) => c - 1);
      return;
    }

    if (currentSlideIndex > 0) {
      const previousSlide = lectureDeck.slides[currentSlideIndex - 1];
      setCurrentSlideIndex((c) => c - 1);
      setCurrentCueIndex(Math.max(previousSlide.cues.length - 1, 0));
    }
  }

  async function startWhiteboardSession(input: {
    mode: WhiteboardMode;
    goal: string;
    title?: string;
    slide: LectureSlide;
    question?: string;
  }) {
    whiteboardAbortRef.current?.abort();
    const controller = new AbortController();
    whiteboardAbortRef.current = controller;

    setWhiteboardOpen(true);
    setWhiteboardContent({
      mode: "canvas",
      title: input.title ?? "Whiteboard",
      tldrawSnapshot: boardSnapshotRef.current,
    });
    setWhiteboardStatus("Working on the board…");

    try {
      const completedContent = await runWhiteboardSession({
        mode: input.mode,
        goal: input.goal,
        title: input.title,
        slide: input.slide,
        deckTitle: lectureDeck?.deckTitle,
        courseName: lectureDeck?.courseName,
        summary: lectureDeck?.summary,
        studyStrategy: lectureDeck?.studyStrategy,
        teachingFormat,
        customInstructions,
        question: input.question,
        sessionId,
        signal: controller.signal,
        getSnapshot: () => canvasRef.current?.getSnapshot(),
        onFocus: (focus) => {
          setTeachingFocus(focus);
          if (focus !== "slides") {
            setWhiteboardOpen(true);
          }
        },
        onContent: (content) => {
          setWhiteboardContent({
            ...content,
            tldrawSnapshot: content.tldrawSnapshot ?? boardSnapshotRef.current,
          });
          if (content.explainerId) setActiveArtifactId(content.explainerId);
          setWhiteboardOpen(true);
        },
        onStep: (step) => {
          setWhiteboardStatus(step.stepSummary);
        },
        applyCanvasActions: async (actions) => {
          await canvasRef.current?.applyActions(actions);
        },
      });

      if (completedContent.explainerId) {
        setActiveArtifactId(completedContent.explainerId);
        setWhiteboardStatus(completedContent.explainerStatus === "completed" ? "Visual explainer ready" : "Rendering visual explainer…");
        setTeachingFocus("whiteboard");
      } else {
        // Keep the finished board visible and reopenable after the agent
        // completes its work instead of letting it flash and disappear.
        setWhiteboardStatus("Board ready - reopen anytime");
        setWhiteboardOpen(true);
        setTeachingFocus("whiteboard");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[studydeck] whiteboard session error", error);
      }
    }
  }

  function handleWhiteboardSnapshotChange(snapshot: string) {
    boardSnapshotRef.current = snapshot;
    if (canvasRef.current) {
      boardSemanticRef.current = {
        version: canvasRef.current.getVersion(),
        shapes: canvasRef.current.getSemanticShapes().slice(0, 120),
        diff: canvasRef.current.getSemanticDiff(),
      };
    }
    if (!sessionId) return;

    if (boardSaveTimeoutRef.current) {
      clearTimeout(boardSaveTimeoutRef.current);
    }

    boardSaveTimeoutRef.current = setTimeout(() => {
      boardSaveAbortRef.current?.abort();
      const controller = new AbortController();
      boardSaveAbortRef.current = controller;

      void (async () => {
        const response = await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            boardSnapshot: snapshot,
            boardVersion: canvasRef.current?.getVersion() ?? initialBoardVersion,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Whiteboard save failed (${response.status}).`);
        }
      })().catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[studydeck] failed to persist whiteboard", error);
        setWhiteboardStatus("Whiteboard changes are local; saving will retry after your next edit.");
      });
    }, 450);
  }

  async function handleAskQuestion(question: string, options?: { includeBoardImage?: boolean }) {
    if (!lectureDeck || !activeSlide) return;

    stopLectureRun();
    whiteboardAbortRef.current?.abort();
    setIsAnswering(true);
    setLiveStatus(checkpointQuestion ? "checkpoint" : "paused");
    setQuestionError("");
    setAnswer("");
    setAnswerSources([]);

    try {
      const boardContext = await buildQuestionBoardContext(options?.includeBoardImage === true);
      const response = await fetch("/api/lecture/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          deckTitle: lectureDeck.deckTitle,
          courseName: lectureDeck.courseName,
          summary: lectureDeck.summary,
          studyStrategy: lectureDeck.studyStrategy,
          teachingFormat,
          customInstructions,
          currentSlide: activeSlide,
          question,
          visualIntent: /animate|animation|visual|diagram|draw|show me|visuali[sz]e|proof|as a video|make it visual/i.test(question),
          boardContext,
        }),
      });

      const payload = (await response.json()) as {
        tutor?: {
          spokenAnswer: string;
          focus: TeachingFocus;
          sources?: TutorSource[];
          whiteboard?: {
            enabled: boolean;
            mode: WhiteboardMode;
            goal: string;
            title?: string;
          };
        };
        answer?: string;
        effects?: TutorEffect[];
        toolTrace?: Array<{ name: string; status: string; error?: string }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to answer question.");
      }

      const tutor = payload.tutor;
      const spoken =
        tutor?.spokenAnswer ?? payload.answer ?? "No answer returned.";

      setAnswer(spoken);
      setAnswerSources(tutor?.sources ?? []);
      setTeachingFocus(tutor?.focus ?? "slides");
      await applyTextTutorEffects(payload.effects ?? []);

      if (tutor?.whiteboard?.enabled) {
        setWhiteboardOpen(true);
        void startWhiteboardSession({
          mode: tutor.whiteboard.mode,
          goal: tutor.whiteboard.goal,
          title: tutor.whiteboard.title,
          slide: activeSlide,
          question,
        });
      } else if (tutor?.focus === "whiteboard" || tutor?.focus === "split") {
        setWhiteboardOpen(true);
      }

      void speakAnswer(spoken);
    } catch (error) {
      setIsAnswering(false);
      setLiveStatus(checkpointQuestion ? "checkpoint" : "paused");
      setQuestionError(
        error instanceof Error ? error.message : "Failed to answer question."
      );
    }
  }

  function resumeLecture() {
    if (!lectureDeck) return;

    setIsAnswering(false);
    setIsLive(true);
    setAnswer("");
    setCheckpointQuestion("");
    setAnswerSources([]);
    setLiveError("");
    const resumeIndex = resumeSlideIndexRef.current ?? currentSlideIndex;
    resumeSlideIndexRef.current = null;
    void runScriptedLecture(lectureDeck, resumeIndex);
  }

  function resumeLectureFromRealtime(options?: { advance?: boolean }) {
    if (options?.advance && lectureDeck) {
      resumeSlideIndexRef.current = Math.min(currentSlideIndex + 1, lectureDeck.slides.length - 1);
    }
    resumeLecture();
  }

  async function runScriptedLecture(
    deck: LectureDeck,
    startSlideIndex: number
  ) {
    const runId = lectureRunRef.current + 1;
    lectureRunRef.current = runId;
    setIsLive(true);

    for (
      let slideIndex = startSlideIndex;
      slideIndex < deck.slides.length;
      slideIndex += 1
    ) {
      if (!isCurrentRun(runId)) return;

      setCurrentSlideIndex(slideIndex);
      setCurrentCueIndex(0);
      setLiveCue(null);
      setLiveStatus("planning");
      prewarmLectureWindow(deck, slideIndex);

      let segment: LectureSegment;

      try {
        segment = await fetchLectureSegment(deck, slideIndex);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to plan lecture.";
        console.error("[studydeck] scripted segment error", error);
        setLiveError(message);
        setLiveStatus("error");
        return;
      }

      const segmentNarration = buildSegmentNarration(segment);
      const warmedSpeech = takeWarmedSpeechPromise(segmentNarration);
      prewarmLectureWindow(deck, slideIndex + 1);

      setLiveStatus("speaking");

      try {
        await playLectureSegment(segment, slideIndex, () => isCurrentRun(runId), warmedSpeech);
        if (!isCurrentRun(runId)) return;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to synthesize speech.";
        console.error("[studydeck] scripted tts error", error);
        setLiveError(message);
        setLiveStatus("error");
        return;
      }

      if (!isCurrentRun(runId)) return;

      setLiveStatus("pausing");
      setLiveCue(null);
      await pauseAwareSleep(
        (segment.endPauseMs ?? 1200) / speechSpeedRef.current,
        () => isCurrentRun(runId),
        () => audioPausedRef.current,
      );

      if (segment.askCheckpoint && segment.checkpointQuestion) {
        resumeSlideIndexRef.current = Math.min(slideIndex + 1, deck.slides.length - 1);
        setLiveStatus("checkpoint");
        setLiveError(segment.checkpointQuestion);
        setCheckpointQuestion(segment.checkpointQuestion);
        setAnswer("");
        setAnswerSources([]);
        setIsAnswering(true);
        return;
      }
    }

    if (isCurrentRun(runId)) {
      setLiveStatus("ended");
      setIsLive(false);
      setLiveCue(null);
      onEndSession?.();
    }
  }

  async function fetchLectureSegment(deck: LectureDeck, slideIndex: number) {
    if (!deck.slides[slideIndex]) {
      throw new Error("Slide is outside the deck.");
    }

    return getSegmentPromise(deck, slideIndex);
  }

  function getSegmentPromise(deck: LectureDeck, slideIndex: number) {
    if (!deck.slides[slideIndex]) {
      return Promise.reject(new Error("Slide is outside the deck."));
    }

    const cacheKey = getSegmentCacheKey(slideIndex);
    const cached = segmentCacheRef.current.get(cacheKey);

    if (cached) {
      return cached;
    }

    const promise = requestLectureSegment(deck, slideIndex).then((segment) => {
      const narration = buildSegmentNarration(segment);
      getWarmedSpeechPromise(narration);
      return segment;
    });
    segmentCacheRef.current.set(cacheKey, promise);
    return promise;
  }

  function prewarmLectureWindow(deck: LectureDeck, fromSlideIndex: number) {
    for (
      let slideIndex = fromSlideIndex;
      slideIndex < Math.min(deck.slides.length, fromSlideIndex + SEGMENT_PREFETCH_AHEAD);
      slideIndex += 1
    ) {
      void getSegmentPromise(deck, slideIndex).catch(() => undefined);
    }
  }

  async function requestLectureSegment(
    deck: LectureDeck,
    slideIndex: number
  ) {
    const response = await fetch("/api/lecture/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deckTitle: deck.deckTitle,
        courseName: deck.courseName,
        summary: deck.summary,
        studyStrategy: deck.studyStrategy,
        teachingFormat,
        customInstructions,
        currentSlide: deck.slides[slideIndex],
        nextSlide: deck.slides[slideIndex + 1],
      }),
    });

    const payload = (await response.json()) as {
      segment?: LectureSegment;
      error?: string;
    };

    if (!response.ok || !payload.segment) {
      throw new Error(payload.error ?? "Failed to generate lecture segment.");
    }

    console.log("[studydeck] scripted segment", {
      slide: payload.segment.slideNumber,
      beats: payload.segment.beats.length,
    });

    return payload.segment;
  }

  async function playLectureSpeech(
    text: string,
    shouldContinue = () => true,
    warmedStream: Promise<SpeechStreamResult> | null = null,
    onPlaybackStart?: () => void,
    cacheable = true,
  ) {
    let lastError = "Failed to generate speech.";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!shouldContinue()) {
        return;
      }

      const result =
        attempt === 0 && warmedStream
          ? await warmedStream
          : await requestSpeechStream(text, cacheable);

      if (!result.response?.ok || !result.response.body) {
        lastError = result.error ?? "Failed to stream speech.";

        if (result.response?.status === 429 && attempt < 2) {
          const retryAfterMs = Math.max(1000, result.retryAfterMs ?? 15_000);
          setLiveStatus("waiting for voice");
          setLiveError("Voice quota hit. Waiting a moment, then continuing.");
          await sleep(retryAfterMs + 500);
          continue;
        }

        break;
      }

      let streamResult: SpeechPlaybackResult;

      try {
        streamResult = await playSpeechStream(
          result.response.body,
          text,
          shouldContinue,
          onPlaybackStart,
        );
      } catch (error) {
        streamResult = {
          ok: false,
          stopped: false,
          error: error instanceof Error ? error.message : "Failed to stream speech.",
        };
      }

      if (streamResult.stopped) {
        return;
      }

      if (streamResult.ok) {
        setLiveError("");
        return;
      }

      lastError = streamResult.error ?? "Failed to stream speech.";

      if (!streamResult.retryAfterMs || attempt >= 2) {
        break;
      }

      const retryAfterMs = Math.max(1000, streamResult.retryAfterMs);
      setLiveStatus("waiting for voice");
      setLiveError("Voice quota hit. Waiting a moment, then continuing.");
      await sleep(retryAfterMs + 500);
    }

    throw new Error(lastError);
  }

  async function playLectureSegment(
    segment: LectureSegment,
    slideIndex: number,
    shouldContinue: () => boolean,
    warmedStream: Promise<SpeechStreamResult> | null,
  ) {
    // A board task is allowed to finish while the lecture advances. Explicit
    // user navigation and session cancellation still abort it via
    // stopLectureRun; moving to the next slide must not silently discard work.
    whiteboardTriggeredRef.current = false;
    setTeachingFocus("slides");
    setWhiteboardOpen(false);
    setWhiteboardStatus(undefined);
    let clearCueTimers: () => void = () => undefined;

    try {
      await playLectureSpeech(
        buildSegmentNarration(segment),
        shouldContinue,
        warmedStream,
        () => {
          clearCueTimers = scheduleSegmentCues(segment, slideIndex, shouldContinue);
        },
      );
    } finally {
      clearCueTimers();
    }
  }

  function getWarmedSpeechPromise(text: string | undefined) {
    const normalizedText = text?.trim();

    if (!normalizedText) {
      return null;
    }

    const cacheKey = getSpeechWarmupCacheKey(normalizedText);
    const cached = speechWarmupCacheRef.current.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const promise = requestSpeechStream(normalizedText);
    speechWarmupCacheRef.current.set(cacheKey, promise);
    return promise;
  }

  function takeWarmedSpeechPromise(text: string | undefined) {
    const normalizedText = text?.trim();

    if (!normalizedText) {
      return null;
    }

    const cacheKey = getSpeechWarmupCacheKey(normalizedText);
    const cached = speechWarmupCacheRef.current.get(cacheKey);

    if (cached === undefined || cached === null) {
      return getWarmedSpeechPromise(normalizedText);
    }

    speechWarmupCacheRef.current.delete(cacheKey);
    // A warmed Response may have been claimed by an older lecture run during
    // a rapid restart/navigation. Never hand the same body to two readers.
    return cached.then(async (result) => {
      if (!result.response?.body) return result;
      try {
        return { ...result, response: result.response.clone() };
      } catch {
        return requestSpeechStream(normalizedText);
      }
    });
  }

  async function requestSpeechStream(text: string, cacheable = true): Promise<SpeechStreamResult> {
    try {
      const response = await fetch("/api/lecture/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, cache: cacheable ? "lecture" : "none" }),
      });

      if (response.ok && response.body) {
        return { response };
      }

      const payload = (await response
        .clone()
        .json()
        .catch(() => ({}))) as StreamSpeechMessage;

      return {
        response,
        error: payload.error ?? "Failed to stream speech.",
        retryAfterMs: payload.retryAfterMs,
      };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Failed to stream speech.",
      };
    }
  }

  async function playSpeechStream(
    body: ReadableStream<Uint8Array>,
    text: string,
    shouldContinue: () => boolean,
    onPlaybackStart?: () => void,
  ): Promise<SpeechPlaybackResult> {
    if (body.locked) {
      return { ok: false, error: "The warmed speech stream was already consumed.", retryAfterMs: 1 };
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastPlayback = Promise.resolve();
    let audioChunks = 0;
    let error = "";
    let retryAfterMs = 0;

    while (true) {
      if (!shouldContinue()) {
        await reader.cancel();
        return { ok: false, stopped: true };
      }

      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const message = parseStreamSpeechMessage(line);

        if (!message) {
          continue;
        }

        if (message.type === "error") {
          error = message.error ?? "Failed to stream speech.";
          retryAfterMs = message.retryAfterMs ?? 0;
          continue;
        }

        if (message.type === "audio" && message.audio) {
          if (!shouldContinue()) {
            await reader.cancel();
            return { ok: false, stopped: true };
          }

          audioChunks += 1;
          if (audioChunks === 1) {
            onPlaybackStart?.();
          }
          lastPlayback =
            audioPlayerRef.current?.queue(
              message.audio,
              message.sampleRate ?? 24000,
              speechSpeedRef.current,
              message.mimeType,
            ) ?? Promise.resolve();
        }
      }
    }

    buffer += decoder.decode();
    const finalMessage = parseStreamSpeechMessage(buffer);

    if (finalMessage?.type === "error") {
      error = finalMessage.error ?? "Failed to stream speech.";
      retryAfterMs = finalMessage.retryAfterMs ?? 0;
    }

    await lastPlayback;

    if (error) {
      return { ok: false, error, retryAfterMs };
    }

    console.log("[studydeck] streamed tts", {
      chars: text.length,
      chunks: audioChunks,
    });

    return { ok: audioChunks > 0, error: audioChunks > 0 ? "" : "No audio returned." };
  }

  function buildSegmentNarration(segment: LectureSegment) {
    return segment.beats
      .map((beat) => beat.narration.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  function scheduleSegmentCues(
    segment: LectureSegment,
    slideIndex: number,
    shouldContinue: () => boolean,
  ) {
    const timers: Array<() => void> = [];
    let elapsedMs = 0;
    const slide = lectureDeck?.slides[slideIndex];
    const plan = segment.whiteboardPlan;

    segment.beats.forEach((beat, index) => {
      const showCue = () => {
        if (!shouldContinue()) return;

        applyLectureBeat(beat, slideIndex);

        if (
          plan &&
          slide &&
          !whiteboardTriggeredRef.current &&
          plan.startAfterBeatIndex === index
        ) {
          whiteboardTriggeredRef.current = true;
          void startWhiteboardSession({
            mode: plan.mode,
            goal: plan.goal,
            title: plan.title,
            slide,
          });
        }
      };

      if (index === 0) {
        showCue();
      } else {
        timers.push(
          pauseAwareTimer(
            showCue,
            Math.max(0, elapsedMs / speechSpeedRef.current),
            shouldContinue,
            () => audioPausedRef.current,
          ),
        );
      }

      elapsedMs += estimateBeatDurationMs(beat.narration) + beat.pauseAfterMs;
    });

    return () => {
      timers.forEach((cancelTimer) => cancelTimer());
    };
  }

  function estimateBeatDurationMs(text: string) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const punctuationPauses = (text.match(/[.;:!?]/g)?.length ?? 0) * 140;

    return Math.max(900, words * 330 + punctuationPauses);
  }

  function parseStreamSpeechMessage(line: string) {
    const trimmed = line.trim();

    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed) as StreamSpeechMessage;
    } catch {
      return null;
    }
  }

  function applyLectureBeat(beat: LectureBeat, slideIndex: number) {
    if (beat.action !== "point") {
      setLiveCue(null);
      return;
    }

    const slide = lectureDeck?.slides[slideIndex];
    const cueIndex = findBestCueIndex(slide, beat);
    const cue = cueIndex >= 0 ? slide?.cues[cueIndex] : null;

    setLiveCue({
      id: beat.id,
      x: normalizeCoordinate(beat.x, cue?.x ?? 50),
      y: normalizeCoordinate(beat.y, cue?.y ?? 50),
      label: beat.label || cue?.label || "Focus here",
      emphasis: beat.emphasis || cue?.emphasis || beat.label || "Focus here",
      targetBullet: cue?.targetBullet ?? 0,
    });

    if (cueIndex >= 0) {
      setCurrentCueIndex(cueIndex);
    }
  }

  function findBestCueIndex(
    slide: LectureDeck["slides"][number] | undefined,
    beat: LectureBeat,
  ) {
    if (!slide?.cues.length) {
      return -1;
    }

    const exactLabelIndex = slide.cues.findIndex(
      (cue) => cue.label.toLowerCase() === (beat.label ?? "").toLowerCase(),
    );

    if (exactLabelIndex >= 0) {
      return exactLabelIndex;
    }

    if (beat.x == null || beat.y == null) {
      return -1;
    }

    const x = normalizeCoordinate(beat.x, 50);
    const y = normalizeCoordinate(beat.y, 50);
    let bestIndex = -1;
    let bestDistance = Infinity;

    slide.cues.forEach((cue, index) => {
      const distance = Math.hypot(cue.x - x, cue.y - y);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestDistance <= 24 ? bestIndex : -1;
  }

  function stopLectureRun() {
    lectureRunRef.current += 1;
    answerRunRef.current += 1;
    whiteboardAbortRef.current?.abort();
    audioPlayerRef.current?.stop();
    setIsAudioPaused(false);
    audioPausedRef.current = false;
  }

  async function buildQuestionBoardContext(includeImage: boolean) {
    const canvas = canvasRef.current;
    if (!canvas) return boardSemanticRef.current;
    const diff = canvas.getSemanticDiff();
    const context: {
      version: number;
      shapes: ReturnType<WhiteboardTldrawHandle["getSemanticShapes"]>;
      diff: ReturnType<WhiteboardTldrawHandle["getSemanticDiff"]>;
      imageDataUrl?: string;
    } = {
      version: canvas.getVersion(),
      shapes: canvas.getSemanticShapes().slice(0, 120),
      diff,
    };
    if (includeImage) {
      context.imageDataUrl = await canvas.getBoardImage();
    }
    return context;
  }

  async function applyTextTutorEffects(effects: TutorEffect[]) {
    for (const effect of effects) {
      if (effect.type === "set_teaching_focus") {
        handleRealtimeFocus(effect.mode);
        continue;
      }
      if (effect.type === "navigate_slide") {
        jumpToSlide(effect.slideIndex, { resumeLecture: false });
        continue;
      }
      if (effect.type === "point_to_slide") {
        if (effect.slideIndex !== currentSlideIndex) {
          jumpToSlide(effect.slideIndex, { resumeLecture: false });
        }
        handleRealtimePoint(effect);
        continue;
      }
      if (effect.type === "create_micro_explainer") {
        handleRealtimeArtifact({ id: effect.jobId, status: effect.status, url: effect.url, specUrl: effect.specUrl, engine: effect.engine, kind: effect.kind });
        continue;
      }
      if (effect.type === "mutate_whiteboard") {
        setWhiteboardOpen(true);
        setTeachingFocus(effect.presentation === "whiteboard" ? "whiteboard" : "split");
        setWhiteboardStatus(effect.explanation ?? "Applying tutor correction...");
        const applied = await applyBoardTransactionWhenReady(effect.transaction);
        if (!applied) setWhiteboardStatus("The board changed while the tutor was working. Nothing was erased.");
      }
    }
  }

  async function applyBoardTransactionWhenReady(transaction: import("@/lib/whiteboard-transaction").BoardTransaction) {
    await canvasRef.current?.whenReady();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = canvasRef.current?.applyTransaction(transaction);
      if (result?.ok) return true;
      if (result?.code === "conflict") {
        setWhiteboardStatus("The board changed while the tutor was working. Nothing was erased.");
        return false;
      }
      await sleep(80);
    }
    return false;
  }

  function activateRealtimeTutor() {
    stopLectureRun();
    // Keep the workspace mounted while the WebRTC session negotiates. The
    // realtime control lives inside this workspace and must survive the
    // scripted lecture handoff.
    setIsLive(true);
    setIsAnswering(false);
    setAnswer("");
    setCheckpointQuestion("");
    setAnswerSources([]);
    setQuestionError("");
    setLiveError("");
    setLiveCue(null);
    setLiveStatus("realtime");
  }

  function requestRealtimeTutor() {
    activateRealtimeTutor();
    setRealtimeConnectRequest((request) => request + 1);
  }

  function handleRealtimeFocus(focus: TeachingFocus) {
    setTeachingFocus(focus);
    if (focus === "slides") {
      setWhiteboardOpen(false);
      return;
    }

    setWhiteboardContent((current) => ({ ...current, mode: "canvas", title: current.title ?? "Realtime board", tldrawSnapshot: boardSnapshotRef.current }));
    setWhiteboardOpen(true);
  }

  function handleRealtimePoint(point: { x: number; y: number; label: string }) {
    setTeachingFocus("slides");
    setLiveCue({
      id: `realtime-${Date.now()}`,
      x: point.x,
      y: point.y,
      label: point.label,
      emphasis: point.label,
      targetBullet: 0,
    });
  }

  function handleRealtimeArtifact(artifact: { id: string; status: string; url?: string; specUrl?: string; engine?: string; kind?: string }) {
    setTeachingFocus("whiteboard");
    setWhiteboardContent((current) => ({ ...current, mode: "canvas", title: "Visual explainer", tldrawSnapshot: boardSnapshotRef.current }));
    setWhiteboardOpen(true);
    setWhiteboardStatus(artifact.status === "completed" ? "Visual ready" : "Rendering visual…");
    void (async () => {
      await canvasRef.current?.whenReady();
      canvasRef.current?.insertVisualArtifact({ id: artifact.id, engine: artifact.engine ?? "diagram", status: artifact.status, artifactUrl: artifact.url, specUrl: artifact.specUrl ?? `/api/render-jobs/${artifact.id}/spec` });
    })();
    setActiveArtifactId(["completed", "failed"].includes(artifact.status) ? null : artifact.id);
  }

  function endSession() {
    stopLectureRun();
    setIsLive(false);
    setIsAnswering(false);
    setIsSpeakingAnswer(false);
    setLiveCue(null);
    onEndSession?.();
  }

  async function toggleAudioPause() {
    audioPlayerRef.current ??= new PcmAudioPlayer();

    if (audioPausedRef.current) {
      audioPausedRef.current = false;
      setIsAudioPaused(false);
      await audioPlayerRef.current.resume();
      setLiveStatus(isAnswering ? "answering" : "speaking");
      return;
    }

    audioPausedRef.current = true;
    setIsAudioPaused(true);
    await audioPlayerRef.current.pause();
    setLiveStatus("paused");
  }

  function isCurrentRun(runId: number) {
    return lectureRunRef.current === runId;
  }

  async function speakAnswer(text: string) {
    const runId = answerRunRef.current + 1;
    answerRunRef.current = runId;
    audioPlayerRef.current ??= new PcmAudioPlayer();
    audioPlayerRef.current.setPlaybackRate(speechSpeedRef.current);
    await audioPlayerRef.current.unlock();
    audioPlayerRef.current.stop();
    setIsSpeakingAnswer(true);

    try {
      await playLectureSpeech(
        text,
        () => answerRunRef.current === runId,
        null,
        undefined,
        false,
      );

      if (answerRunRef.current !== runId) {
        return;
      }
    } catch (error) {
      console.error("[studydeck] answer tts error", error);
    } finally {
      if (answerRunRef.current === runId) {
        setIsSpeakingAnswer(false);
      }
    }
  }

  function handleSpeedChange(speed: number) {
    const normalizedSpeed = Math.min(1.15, Math.max(0.9, speed));
    speechSpeedRef.current = normalizedSpeed;
    audioPlayerRef.current?.setPlaybackRate(normalizedSpeed);
    speechWarmupCacheRef.current.clear();
    setSpeechSpeed(normalizedSpeed);
  }

  function handleTeachingSettingsChange(settings: {
    teachingFormat: TeachingFormat;
    customInstructions: string;
  }) {
    setTeachingFormat(settings.teachingFormat);
    setCustomInstructions(settings.customInstructions);
    segmentCacheRef.current.clear();
    speechWarmupCacheRef.current.clear();

    if (sessionId) {
      void fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    }
  }

  function getSegmentCacheKey(slideIndex: number) {
    return [slideIndex, teachingFormat, customInstructions.trim()].join("::");
  }

  function getSpeechWarmupCacheKey(text: string) {
    return [
      teachingFormat,
      customInstructions.trim(),
      speechSpeedRef.current.toFixed(2),
      text,
    ].join("::");
  }

  // Show a start screen when not live
  if (!isLive) {
    const slide = lectureDeck.slides[currentSlideIndex];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 bg-[var(--page)]">
        <div className="w-full max-w-lg animate-fade-in text-center">
          <div className="mb-3 flex items-center justify-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--ink-strong)]">
              {lectureDeck.deckTitle}
            </h1>
          </div>
          <p className="text-sm text-[var(--muted)] mb-6">
            {lectureDeck.courseName} &middot; {lectureDeck.totalSlides} slides
          </p>
          {slide && (
            <div className="mb-8 rounded-xl border border-[var(--line)] bg-[var(--paper)] overflow-hidden">
              <Image
                src={slide.imageUrl}
                alt={slide.title}
                width={1200}
                height={675}
                unoptimized
                className="w-full h-auto"
              />
              <div className="p-4 text-left">
                <p className="text-sm font-medium text-[var(--ink-strong)]">
                  Slide {currentSlideIndex + 1} of {lectureDeck.totalSlides}
                </p>
                <p className="text-xs text-[var(--muted)] mt-1">{slide.title}</p>
              </div>
            </div>
          )}
          {isAutoStarting ? (
            <p className="mb-6 text-sm text-[var(--muted)]">
              Starting with your saved lecture settings...
            </p>
          ) : liveError ? (
            <p className="mb-6 text-sm text-[var(--muted)]">{liveError}</p>
          ) : null}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => startLecture()}
              disabled={isAutoStarting}
              className="rounded-lg bg-[var(--ink-strong)] px-8 py-3 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
            >
              {currentSlideIndex > 0 ? "Resume lecture" : "Start lecture"}
            </button>
            {onEndSession && (
              <button
                onClick={endSession}
                className="rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-6 py-3 text-sm font-medium text-[var(--ink-strong)] transition hover:bg-[var(--panel-hover)]"
              >
                End session
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <LectureWorkspace
      lectureDeck={lectureDeck}
      sessionId={sessionId}
      isLive={isLive}
      currentSlideIndex={currentSlideIndex}
      currentCueIndex={currentCueIndex}
      activeSlide={activeSlide}
      activeCue={activeCue}
      onNextCue={nextCue}
      onPrevCue={prevCue}
      onJumpToSlide={jumpToSlide}
      onAskQuestion={handleAskQuestion}
      onResume={resumeLecture}
      onSpeakAnswer={speakAnswer}
      isAnswering={isAnswering}
      isSpeakingAnswer={isSpeakingAnswer}
      answer={answer}
      checkpointQuestion={checkpointQuestion}
      answerSources={answerSources}
      questionError={questionError}
      liveStatus={liveStatus}
      liveError={liveError}
      isAudioPaused={isAudioPaused}
      speechSpeed={speechSpeed}
      onSpeedChange={handleSpeedChange}
      teachingFormat={teachingFormat}
      customInstructions={customInstructions}
      onTeachingSettingsChange={handleTeachingSettingsChange}
      whiteboardOpen={whiteboardOpen}
      whiteboardContent={whiteboardContent}
      whiteboardStatus={whiteboardStatus}
      teachingFocus={teachingFocus}
      canvasRef={canvasRef}
      initialBoardVersion={initialBoardVersion}
      onWhiteboardSnapshotChange={handleWhiteboardSnapshotChange}
      onWhiteboardOpen={() => {
        setWhiteboardOpen(true);
        setTeachingFocus("whiteboard");
        setWhiteboardStatus("Board ready");
      }}
      onActivateRealtime={requestRealtimeTutor}
      onRealtimeSessionActivate={activateRealtimeTutor}
      realtimeConnectRequest={realtimeConnectRequest}
      realtimeState={realtimeState}
      onRealtimeStateChange={setRealtimeState}
      onRealtimeFallback={resumeLecture}
      onRealtimeResumeLecture={resumeLectureFromRealtime}
      onRealtimeFocus={handleRealtimeFocus}
      onRealtimePoint={handleRealtimePoint}
      onRealtimeJumpToSlide={(slideIndex) => {
        const from = lectureDeck.slides[currentSlideIndex];
        const destination = lectureDeck.slides[slideIndex];
        if (from && destination && Math.abs(slideIndex - currentSlideIndex) > 1) {
          setLiveStatus(`Connected page ${destination.slideNumber} to page ${from.slideNumber}; skipped pages remain available`);
        }
        jumpToSlide(slideIndex, { resumeLecture: false });
      }}
      onRealtimeArtifact={handleRealtimeArtifact}
      onWhiteboardClose={() => {
        whiteboardAbortRef.current?.abort();
        setWhiteboardOpen(false);
        setTeachingFocus("slides");
        setWhiteboardStatus(undefined);
      }}
      onToggleAudioPause={toggleAudioPause}
      onEndSession={endSession}
    />
  );
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pauseAwareSleep(
  ms: number,
  shouldContinue: () => boolean,
  isPaused: () => boolean,
) {
  const startedAt = performance.now();
  let pausedAt = 0;
  let pausedMs = 0;

  while (shouldContinue()) {
    if (isPaused()) {
      pausedAt ||= performance.now();
      await sleep(80);
      continue;
    }

    if (pausedAt) {
      pausedMs += performance.now() - pausedAt;
      pausedAt = 0;
    }

    if (performance.now() - startedAt - pausedMs >= ms) {
      return;
    }

    await sleep(80);
  }
}

function pauseAwareTimer(
  callback: () => void,
  delayMs: number,
  shouldContinue: () => boolean,
  isPaused: () => boolean,
) {
  let cancelled = false;

  void pauseAwareSleep(
    delayMs,
    () => shouldContinue() && !cancelled,
    isPaused,
  ).then(() => {
    if (!cancelled && shouldContinue()) {
      callback();
    }
  });

  return () => {
    cancelled = true;
  };
}

function clampPercent(value: number) {
  return Math.min(96, Math.max(4, value));
}

function normalizeCoordinate(value: number | undefined, fallback: number) {
  if (value == null) {
    return clampPercent(fallback);
  }

  return clampPercent(value >= 0 && value <= 1 ? value * 100 : value);
}
