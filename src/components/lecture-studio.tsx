"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type {
  LectureBeat,
  LectureDeck,
  LectureSegment,
  LectureSlide,
  TeachingFormat,
  WhiteboardContent,
  WhiteboardMode,
} from "@/lib/aiprof-types";
import { runWhiteboardSession } from "@/lib/run-whiteboard-session";
import type { TeachingFocus } from "@/lib/whiteboard-types";

import { LectureWorkspace } from "@/components/lecture-workspace";
import type { WhiteboardTldrawHandle } from "@/components/whiteboard-tldraw";
import { PcmAudioPlayer } from "@/lib/live-audio";

const DEFAULT_SPEECH_SPEED = 1.03;
const SEGMENT_PREFETCH_AHEAD = 3;

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
  const [questionError, setQuestionError] = useState("");
  const [liveStatus, setLiveStatus] = useState("idle");
  const [liveError, setLiveError] = useState("");
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
  const [whiteboardContent, setWhiteboardContent] = useState<WhiteboardContent>({
    mode: "text",
    title: "Whiteboard",
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
  const lectureRunRef = useRef(0);
  const answerRunRef = useRef(0);
  const speechSpeedRef = useRef(DEFAULT_SPEECH_SPEED);
  const resumeSlideIndexRef = useRef<number | null>(null);
  const audioPausedRef = useRef(false);
  const autoStartAttemptedRef = useRef(false);
  const startLectureRef = useRef<
    (options?: StartLectureOptions) => Promise<void>
  >(async () => undefined);
  const prewarmLectureWindowRef = useRef<
    (deck: LectureDeck, fromSlideIndex: number) => void
  >(() => undefined);
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
    void startLectureRef.current({ automatic: true });
  }, [autoStart]);

  useEffect(() => {
    prewarmLectureWindowRef.current(lectureDeck, initialSlideIndex);
  }, [lectureDeck, initialSlideIndex]);

  async function startLecture(options?: StartLectureOptions) {
    if (!lectureDeck) return;

    try {
      setIsAutoStarting(Boolean(options?.automatic));
      setLiveStatus("starting");
      audioPlayerRef.current ??= new PcmAudioPlayer();
      audioPlayerRef.current.setPlaybackRate(speechSpeedRef.current);
      await audioPlayerRef.current.unlock();
      setIsAutoStarting(false);
      setIsLive(true);
      setIsAudioPaused(false);
      audioPausedRef.current = false;
      setIsAnswering(false);
      setAnswer("");
      setLiveError("");
      prewarmLectureWindow(lectureDeck, currentSlideIndex);
      void runScriptedLecture(lectureDeck, currentSlideIndex);
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

  function jumpToSlide(index: number) {
    if (!lectureDeck) return;

    stopLectureRun();
    setCurrentSlideIndex(index);
    setCurrentCueIndex(0);
    setLiveCue(null);

    if (isLive && !isAnswering) {
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
      mode: input.mode,
      title: input.title ?? "Whiteboard",
    });
    setWhiteboardStatus("Working on the board…");

    try {
      await runWhiteboardSession({
        mode: input.mode,
        goal: input.goal,
        title: input.title,
        slide: input.slide,
        deckTitle: lectureDeck?.deckTitle,
        courseName: lectureDeck?.courseName,
        question: input.question,
        signal: controller.signal,
        getSnapshot: () => canvasRef.current?.getSnapshot(),
        onFocus: (focus) => {
          setTeachingFocus(focus);
          if (focus !== "slides") {
            setWhiteboardOpen(true);
          }
        },
        onContent: (content) => {
          setWhiteboardContent(content);
          setWhiteboardOpen(true);
        },
        onStep: (step) => {
          setWhiteboardStatus(step.stepSummary);
        },
        applyCanvasActions: (actions) => {
          canvasRef.current?.applyActions(actions);
        },
      });

      setWhiteboardStatus(undefined);
      setTeachingFocus("slides");
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[studydeck] whiteboard session error", error);
      }
    }
  }

  async function handleAskQuestion(question: string) {
    if (!lectureDeck || !activeSlide) return;

    stopLectureRun();
    whiteboardAbortRef.current?.abort();
    setIsAnswering(true);
    setLiveStatus("paused");
    setQuestionError("");
    setAnswer("");

    try {
      const response = await fetch("/api/lecture/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckTitle: lectureDeck.deckTitle,
          courseName: lectureDeck.courseName,
          summary: lectureDeck.summary,
          studyStrategy: lectureDeck.studyStrategy,
          teachingFormat,
          customInstructions,
          currentSlide: activeSlide,
          question,
        }),
      });

      const payload = (await response.json()) as {
        tutor?: {
          spokenAnswer: string;
          focus: TeachingFocus;
          whiteboard?: {
            enabled: boolean;
            mode: WhiteboardMode;
            goal: string;
            title?: string;
          };
        };
        answer?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to answer question.");
      }

      const tutor = payload.tutor;
      const spoken =
        tutor?.spokenAnswer ?? payload.answer ?? "No answer returned.";

      setAnswer(spoken);
      setTeachingFocus(tutor?.focus ?? "slides");

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
    const resumeIndex = resumeSlideIndexRef.current ?? currentSlideIndex;
    resumeSlideIndexRef.current = null;
    void runScriptedLecture(lectureDeck, resumeIndex);
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
        setAnswer(segment.checkpointQuestion);
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

  prewarmLectureWindowRef.current = prewarmLectureWindow;

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
  ) {
    let lastError = "Failed to generate speech.";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!shouldContinue()) {
        return;
      }

      const result =
        attempt === 0 && warmedStream
          ? await warmedStream
          : await requestSpeechStream(text);

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
    whiteboardAbortRef.current?.abort();
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

    if (cached === undefined) {
      return getWarmedSpeechPromise(normalizedText);
    }

    speechWarmupCacheRef.current.delete(cacheKey);
    return cached;
  }

  async function requestSpeechStream(text: string): Promise<SpeechStreamResult> {
    try {
      const response = await fetch("/api/lecture/tts/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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
      await playLectureSpeech(text, () => answerRunRef.current === runId);

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
