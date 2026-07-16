"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

import type {
  LectureCue,
  LectureDeck,
  LectureSlide,
  TeachingFormat,
  TutorSource,
  WhiteboardContent,
} from "@/lib/aiprof-types";
import type {
  TeachingFocus,
} from "@/lib/whiteboard-types";
import { WhiteboardPanel } from "@/components/whiteboard-panel";
import type { WhiteboardTldrawHandle } from "@/components/whiteboard-tldraw";
import {
  isRealtimeActive,
  RealtimeTutor,
  type RealtimeTutorState,
} from "@/components/realtime-tutor";

function CursorPointer({
  x,
  y,
  visible,
}: {
  x: number;
  y: number;
  visible: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        opacity: visible ? 1 : 0,
        transform: "translate(-50%, -50%)",
        transition:
          "left 560ms cubic-bezier(0.22, 1, 0.36, 1), top 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out",
      }}
    >
      {/* Clicky-style blue triangle cursor */}
      <svg
        width="22"
        height="24"
        viewBox="0 0 22 24"
        style={{
          filter:
            "drop-shadow(0 0 6px var(--cursor-blue-glow)) drop-shadow(0 0 16px rgba(77, 158, 248, 0.25)) drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
        }}
        aria-hidden
      >
        <path
          d="M2 2l18 10L2 22V2z"
          fill="var(--cursor-blue)"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {/* Landing pulse ring */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: "var(--cursor-blue)",
          boxShadow: "0 0 8px var(--cursor-blue-glow)",
          animation: "cursor-pulse 1.8s ease-in-out infinite",
        }}
      />
    </div>
  );
}

// Clicky-style spinner — shown while AI is processing
function CursorSpinner() {
  return (
    <div
      className="pointer-events-none absolute z-20 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      aria-hidden
    >
      <svg
        className="animate-spin"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        style={{ filter: "drop-shadow(0 0 5px var(--cursor-blue-glow))" }}
      >
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          stroke="url(#spin-grad)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="20 12"
        />
        <defs>
          <linearGradient id="spin-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--cursor-blue)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--cursor-blue)" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------

type Props = {
  lectureDeck: LectureDeck;
  isLive: boolean;
  currentSlideIndex: number;
  currentCueIndex: number;
  activeSlide: LectureSlide | null;
  activeCue: LectureCue | null;
  onNextCue: () => void;
  onPrevCue: () => void;
  onJumpToSlide: (index: number) => void;
  onAskQuestion: (question: string, options?: { includeBoardImage?: boolean }) => Promise<void>;
  onResume: () => void;
  onSpeakAnswer: (answer: string) => Promise<void>;
  isAnswering: boolean;
  isSpeakingAnswer: boolean;
  answer: string;
  checkpointQuestion: string;
  answerSources: TutorSource[];
  questionError: string;
  liveStatus: string;
  liveError: string;
  sessionId?: string;
  onActivateRealtime?: () => void;
  onRealtimeSessionActivate?: () => void;
  realtimeConnectRequest?: number;
  realtimeState?: RealtimeTutorState;
  onRealtimeStateChange?: (state: RealtimeTutorState) => void;
  onRealtimeFallback?: () => void;
  onRealtimeResumeLecture?: (options?: { advance?: boolean }) => void;
  onRealtimeFocus?: (focus: TeachingFocus) => void;
  onRealtimePoint?: (point: { x: number; y: number; label: string }) => void;
  onRealtimeJumpToSlide?: (slideIndex: number) => void;
  onRealtimeArtifact?: (artifact: { id: string; status: string; url?: string }) => void;
  isAudioPaused: boolean;
  speechSpeed: number;
  onSpeedChange: (speed: number) => void;
  teachingFormat: TeachingFormat;
  customInstructions: string;
  onTeachingSettingsChange: (settings: {
    teachingFormat: TeachingFormat;
    customInstructions: string;
  }) => void;
  whiteboardOpen: boolean;
  whiteboardContent: WhiteboardContent;
  whiteboardStatus?: string;
  teachingFocus: TeachingFocus;
  canvasRef?: React.RefObject<WhiteboardTldrawHandle | null>;
  initialBoardVersion?: number;
  onWhiteboardSnapshotChange?: (snapshot: string) => void;
  onWhiteboardOpen?: () => void;
  onWhiteboardClose?: () => void;
  onToggleAudioPause?: () => void;
  onEndSession?: () => void;
};

export function LectureWorkspace({
  lectureDeck,
  isLive,
  currentSlideIndex,
  currentCueIndex,
  activeSlide,
  activeCue,
  onNextCue,
  onPrevCue,
  onJumpToSlide,
  onAskQuestion,
  onResume,
  onSpeakAnswer,
  isAnswering,
  isSpeakingAnswer,
  answer,
  checkpointQuestion,
  answerSources,
  questionError,
  liveStatus,
  liveError,
  sessionId,
  onActivateRealtime,
  onRealtimeSessionActivate,
  realtimeConnectRequest,
  realtimeState = "idle",
  onRealtimeStateChange,
  onRealtimeFallback,
  onRealtimeResumeLecture,
  onRealtimeFocus,
  onRealtimePoint,
  onRealtimeJumpToSlide,
  onRealtimeArtifact,
  isAudioPaused,
  speechSpeed,
  onSpeedChange,
  teachingFormat,
  customInstructions,
  onTeachingSettingsChange,
  whiteboardOpen,
  whiteboardContent,
  whiteboardStatus,
  teachingFocus,
  canvasRef,
  initialBoardVersion,
  onWhiteboardSnapshotChange,
  onWhiteboardOpen,
  onWhiteboardClose,
  onToggleAudioPause,
  onEndSession,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const [recallBusy, setRecallBusy] = useState<string | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [questionDraft, setQuestionDraft] = useState("");
  const [includeBoardImage, setIncludeBoardImage] = useState(false);
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "realtime">("text");
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [displayedCue, setDisplayedCue] = useState<LectureCue | null>(activeCue);
  const [cursorVisible, setCursorVisible] = useState(Boolean(activeCue));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cursorHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorFrameRef = useRef<number | null>(null);
  const isCheckpoint = Boolean(checkpointQuestion.trim());
  const realtimeActive = isRealtimeActive(realtimeState);
  const isBoardVisible = whiteboardOpen && teachingFocus !== "slides";
  const hasBoardContent = Boolean(
    whiteboardOpen ||
      whiteboardContent.tldrawSnapshot ||
      whiteboardContent.text?.trim() ||
      whiteboardContent.latex?.trim() ||
      whiteboardContent.manimCode?.trim() ||
      whiteboardContent.strokes?.length ||
      whiteboardContent.explainerId ||
      whiteboardContent.explainerUrl ||
      whiteboardContent.explainerVideoUrl,
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch("/api/learning/signals?dueOnly=true&limit=4", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { reviewItems?: ReviewItem[] } | null) => {
        if (!cancelled) setReviewItems(payload?.reviewItems ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionId]);

  const totalSlides = lectureDeck.slides.length;
  const totalCues = activeSlide?.cues.length ?? 0;

  const showWhiteboard = whiteboardOpen && teachingFocus !== "slides";
  const showSlide =
    teachingFocus !== "whiteboard" || !whiteboardOpen;
  const stageGridClass = showWhiteboard
    ? teachingFocus === "whiteboard"
      ? "grid-cols-1"
      : "grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]"
    : "grid-cols-1";

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!isCheckpoint) return;

    // A checkpoint is an explicit turn-taking moment. Open the composer and
    // default to text so the learner always has a visible way to respond,
    // even when browser speech recognition is unavailable.
    setDrawerOpen(true);
    setInputMode("text");
    setQuestionDraft("");
    setVoiceError("");
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 120);

    return () => window.clearTimeout(focusTimer);
  }, [isCheckpoint]);

  useEffect(() => {
    if (cursorHideTimeoutRef.current) {
      clearTimeout(cursorHideTimeoutRef.current);
      cursorHideTimeoutRef.current = null;
    }
    if (cursorFrameRef.current) {
      cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null;
    }

    if (activeCue && isLive && !isAnswering) {
      cursorFrameRef.current = requestAnimationFrame(() => {
        setDisplayedCue(activeCue);
        setCursorVisible(true);
        cursorFrameRef.current = null;
      });
      return;
    }

    cursorFrameRef.current = requestAnimationFrame(() => {
      setCursorVisible(false);
      cursorFrameRef.current = null;
    });
    cursorHideTimeoutRef.current = setTimeout(() => {
      setDisplayedCue(null);
      cursorHideTimeoutRef.current = null;
    }, 650);

    return () => {
      if (cursorHideTimeoutRef.current) {
        clearTimeout(cursorHideTimeoutRef.current);
      }
      if (cursorFrameRef.current) {
        cancelAnimationFrame(cursorFrameRef.current);
      }
    };
  }, [activeCue, isAnswering, isLive]);

  // Open drawer and focus textarea when ask is clicked
  function handleOpenAsk() {
    setDrawerOpen(true);
    setTimeout(() => {
      if (inputMode === "text") {
        textareaRef.current?.focus();
      }
    }, 200);
  }

  async function handleAsk() {
    if (!questionDraft.trim() || isSubmittingQuestion) return;
    setIsSubmittingQuestion(true);
    try {
      await onAskQuestion(questionDraft.trim(), { includeBoardImage });
    } finally {
      setIsSubmittingQuestion(false);
    }
  }

  function handleRealtimeMode() {
    recognitionRef.current?.stop();
    setIsListening(false);
    setVoiceError("");
    setQuestionDraft("");
    setInputMode("realtime");
    onActivateRealtime?.();
  }

  function handleRealtimeSessionActivate() {
    setInputMode("realtime");
    onRealtimeSessionActivate?.();
  }

  function handleResume() {
    recognitionRef.current?.stop();
    setIsListening(false);
    setIsSubmittingQuestion(false);
    onResume();
    setDrawerOpen(false);
    setQuestionDraft("");
  }

  function toggleListening() {
    setVoiceError("");

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      setVoiceError("Voice input is not supported in this browser.");
      setInputMode("text");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();

      setQuestionDraft(transcript);
    };
    recognition.onerror = () => {
      setVoiceError("Could not capture voice. Try text instead.");
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  const liveStatusDot =
    isCheckpoint && !answer
      ? "var(--cursor-blue)"
      : isAnswering
        ? "#d97706"
        : isLive
          ? "#4ade80"
          : "rgba(255,255,255,0.25)";

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#111]">
      {/* ------------------------------------------------------------------ */}
      {/* Top bar                                                             */}
      {/* ------------------------------------------------------------------ */}
      <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-white/6 px-5">
        <div className="flex items-center gap-3">
          {/* Status dot with glow — mimics Clicky's header dot */}
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: liveStatusDot,
              boxShadow: (isLive && !isAnswering) || (isCheckpoint && !answer)
                ? `0 0 6px ${liveStatusDot}`
                : "none",
            }}
          />
          <span className="text-sm font-semibold text-white/90 tracking-tight">
            studydeck
          </span>
          {lectureDeck.deckTitle && (
            <>
              <span className="text-white/20">/</span>
              <span className="max-w-[18rem] truncate text-sm text-white/45">
                {lectureDeck.deckTitle}
              </span>
            </>
          )}
          <span className="hidden text-xs text-white/25 sm:inline">
            {liveStatus === "speaking"
              ? "professor speaking"
              : liveStatus === "checkpoint"
                ? "waiting for your answer"
                : liveStatus}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <SpeedSelect value={speechSpeed} onChange={onSpeedChange} />
          {hasBoardContent && (onWhiteboardOpen || onWhiteboardClose) ? (
            <button
              type="button"
              onClick={() => {
                if (isBoardVisible) {
                  onWhiteboardClose?.();
                } else {
                  onWhiteboardOpen?.();
                }
              }}
              className="rounded-md px-3 py-1.5 text-xs text-white/55 transition hover:bg-white/6 hover:text-white/80"
              aria-label={isBoardVisible ? "Hide whiteboard" : "Show whiteboard"}
            >
              {isBoardVisible ? "Hide board" : "Board"}
            </button>
          ) : null}
          <RealtimeTutor
            deck={lectureDeck}
            sessionId={sessionId}
            currentSlideIndex={currentSlideIndex}
            teachingFormat={teachingFormat}
            customInstructions={customInstructions}
            canvasRef={canvasRef}
            onActivate={handleRealtimeSessionActivate}
            realtimeEnabled={inputMode === "realtime"}
            connectRequest={realtimeConnectRequest}
            onStateChange={onRealtimeStateChange}
            onFallback={onRealtimeFallback}
            onResumeLecture={(options) => {
              setInputMode("text");
              setDrawerOpen(false);
              onRealtimeResumeLecture?.(options);
            }}
            onFocus={onRealtimeFocus}
            onPoint={onRealtimePoint}
            onJumpToSlide={onRealtimeJumpToSlide ?? onJumpToSlide}
            onArtifact={onRealtimeArtifact}
          />
          {onToggleAudioPause && (
            <button
              type="button"
              onClick={onToggleAudioPause}
              className="rounded-md px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/6 hover:text-white/70"
            >
              {isAudioPaused ? "Resume" : "Pause"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="rounded-md px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/6 hover:text-white/70"
          >
            Format
          </button>
          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            className="rounded-md px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/6 hover:text-white/70"
          >
            {railOpen ? "Hide outline" : "Outline"}
          </button>
          {sessionId ? (
            <button
              type="button"
              onClick={() => setRecallOpen((v) => !v)}
              aria-label="Open active recall queue"
              className="rounded-md px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/6 hover:text-white/70"
            >
              Recall{reviewItems.length ? ` · ${reviewItems.length}` : ""}
            </button>
          ) : null}
          {onEndSession && (
            <button
              type="button"
              onClick={onEndSession}
              className="rounded-md px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/6 hover:text-white/70"
            >
              End session
            </button>
          )}
        </div>
      </header>

      {settingsOpen && (
        <TeachingSettingsPopover
          teachingFormat={teachingFormat}
          customInstructions={customInstructions}
          onChange={onTeachingSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {recallOpen && sessionId ? (
        <RecallPopover
          items={reviewItems}
          busyId={recallBusy}
          onClose={() => setRecallOpen(false)}
          onOutcome={async (item, outcome) => {
            setRecallBusy(item.id);
            try {
              const response = await fetch("/api/learning/signals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId,
                  concept: item.conceptKey,
                  outcome,
                  evidence: `Active recall response for: ${item.prompt}`,
                  prompt: item.prompt,
                }),
              });
              if (response.ok) setReviewItems((current) => current.filter((entry) => entry.id !== item.id));
            } finally {
              setRecallBusy(null);
            }
          }}
        />
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Main area                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Slide stage */}
        <main className="relative flex flex-1 flex-col overflow-hidden">
          {/* Very subtle top vignette */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/30 to-transparent" />

          {/* Content area */}
          <div className="relative flex flex-1 flex-col items-center justify-center px-10 py-16">
            <div
              className={`relative z-[1] grid h-full w-full max-w-7xl items-center gap-4 animate-fade-in ${stageGridClass}`}
            >
              {showSlide ? (
                <div
                  className={`relative h-[min(68vh,calc(100vh-13rem))] w-full overflow-hidden rounded-lg bg-white shadow-[0_30px_90px_rgba(0,0,0,0.42)] ${
                    showWhiteboard && teachingFocus === "split"
                      ? "opacity-100"
                      : ""
                  }`}
                >
                  {activeSlide ? (
                    <Image
                      src={activeSlide.imageUrl}
                      alt={`Slide ${activeSlide.slideNumber}`}
                      fill
                      priority
                      unoptimized
                      sizes="(max-width: 1024px) 90vw, 1024px"
                      className="object-contain"
                    />
                  ) : (
                    <div className="h-full w-full bg-white" />
                  )}

                  {displayedCue && (
                    <div className="pointer-events-none absolute inset-0">
                      <div
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{
                          left: `${displayedCue.x}%`,
                          top: `${displayedCue.y}%`,
                          opacity: cursorVisible ? 1 : 0,
                          width: "48px",
                          height: "48px",
                          background:
                            "radial-gradient(circle at center, var(--cursor-blue-bg), rgba(77, 158, 248, 0.06) 50%, transparent 70%)",
                          borderRadius: "50%",
                          filter: "blur(1px)",
                          transition:
                            "left 560ms cubic-bezier(0.22, 1, 0.36, 1), top 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out",
                        }}
                        aria-hidden
                      />
                      <CursorPointer
                        x={displayedCue.x}
                        y={displayedCue.y}
                        visible={cursorVisible}
                      />
                    </div>
                  )}

                  {isAnswering && displayedCue && (
                    <div
                      className="pointer-events-none absolute z-20"
                      style={{
                        left: `${displayedCue.x}%`,
                        top: `${displayedCue.y}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <CursorSpinner />
                    </div>
                  )}
                </div>
              ) : null}

              <WhiteboardPanel
                content={whiteboardContent}
                canvasRef={canvasRef}
                initialVersion={initialBoardVersion}
                onSnapshotChange={onWhiteboardSnapshotChange}
                status={whiteboardStatus}
                onClose={onWhiteboardClose}
                className={showWhiteboard
                  ? "h-[min(68vh,calc(100vh-13rem))]"
                  : "!absolute inset-0 z-[-1] h-full w-full opacity-0 pointer-events-none"}
              />

              <div className="col-span-full flex w-full items-center justify-between gap-4 text-xs text-white/35">
                <div className="min-w-0">
                  <p className="truncate text-white/60">
                    {activeSlide?.title ?? "Waiting for lecture"}
                  </p>
                  {activeCue && isLive && !isAnswering ? (
                    <p className="mt-1 truncate">{activeCue.emphasis}</p>
                  ) : null}
                  {isCheckpoint ? (
                    <p className="mt-1 text-[var(--cursor-blue)]">
                      Checkpoint · your response is needed
                    </p>
                  ) : isAnswering ? (
                    <p className="mt-1">Lecture paused while answering.</p>
                  ) : null}
                  {liveError && !isCheckpoint ? (
                    <p className="mt-1 text-amber-300">{liveError}</p>
                  ) : null}
                </div>
                {activeSlide?.examRelevance === "high" ? (
                  <span
                    className="shrink-0 rounded-sm px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.18em]"
                    style={{
                      background: "var(--cursor-blue-bg)",
                      color: "var(--cursor-blue)",
                    }}
                  >
                    Exam
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Coach note footer strip */}
          {activeSlide?.coachNote && (
            <div className="shrink-0 border-t border-white/5 px-10 py-3">
              <p className="text-xs leading-6 text-white/22">
                <span className="mr-2 text-white/15 uppercase tracking-[0.2em]">
                  Note
                </span>
                {activeSlide.coachNote}
              </p>
            </div>
          )}
        </main>

        {/* Outline rail — Clicky panel aesthetic */}
        {railOpen && (
          <aside className="z-20 flex w-60 shrink-0 flex-col overflow-y-auto border-l border-white/6 bg-[#0e0e0e]">
            <div className="px-4 pt-5 pb-3">
              <p className="text-[0.65rem] uppercase tracking-[0.26em] text-white/25">
                Outline
              </p>
            </div>
            <div className="flex-1 space-y-px px-2 pb-4">
              {lectureDeck.slides.map((slide, i) => {
                const active = i === currentSlideIndex;
                return (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => {
                      onJumpToSlide(i);
                      setRailOpen(false);
                    }}
                    className="w-full rounded-lg px-3 py-2.5 text-left transition"
                    style={{
                      background: active
                        ? "rgba(255,255,255,0.08)"
                        : "transparent",
                      color: active
                        ? "rgba(255,255,255,0.85)"
                        : "rgba(255,255,255,0.35)",
                    }}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background:
                            slide.examRelevance === "high"
                              ? "var(--cursor-blue)"
                              : "rgba(255,255,255,0.18)",
                        }}
                      />
                      <span className="text-[0.6rem] uppercase tracking-[0.18em] opacity-50">
                        Slide {slide.slideNumber}
                      </span>
                    </div>
                    <p className="text-xs leading-5">{slide.title}</p>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bottom controls bar                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div
        className={`relative z-30 shrink-0 border-t border-white/6 bg-[#0e0e0e] px-5 py-3 transition duration-200 ${
          drawerOpen ? "pointer-events-none translate-y-3 opacity-0" : "opacity-100"
        }`}
      >
        <div className="mx-auto grid max-w-5xl grid-cols-[11rem_minmax(0,1fr)_auto] items-center gap-4">
          {/* Prev / counter / next */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrevCue}
              aria-label="Previous beat"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/35 transition hover:bg-white/6 hover:text-white/75"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="min-w-[7rem] text-center text-xs tabular-nums text-white/35">
              {activeSlide
                ? `${currentSlideIndex + 1} / ${totalSlides}${
                    totalCues > 1 ? ` · cue ${currentCueIndex + 1}/${totalCues}` : ""
                  }`
                : `${totalSlides} slides`}
            </span>
            <button
              type="button"
              onClick={onNextCue}
              aria-label="Next beat"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/35 transition hover:bg-white/6 hover:text-white/75"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Slide scrubber dots */}
          <div className="hidden flex-1 items-center justify-center gap-1.5 sm:flex">
            {lectureDeck.slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => onJumpToSlide(i)}
                aria-label={slide.title}
                className="rounded-full transition-all duration-300"
                style={{
                  width: i === currentSlideIndex ? 8 : 6,
                  height: i === currentSlideIndex ? 8 : 6,
                  background:
                    i === currentSlideIndex
                      ? "var(--cursor-blue)"
                      : "rgba(255,255,255,0.18)",
                  boxShadow:
                    i === currentSlideIndex
                      ? "0 0 6px var(--cursor-blue-glow)"
                      : "none",
                }}
              />
            ))}
          </div>

          {/* Ask button — Clicky capsule style */}
          <button
            type="button"
            onClick={handleOpenAsk}
            className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition"
            style={{
              background:
                drawerOpen || isAnswering
                  ? "var(--cursor-blue)"
                  : "rgba(255,255,255,0.08)",
              color:
                drawerOpen || isAnswering
                  ? "#fff"
                  : "rgba(255,255,255,0.55)",
              boxShadow:
                drawerOpen || isAnswering
                  ? "0 0 12px var(--cursor-blue-glow)"
                  : "none",
            }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
            Ask
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Q&A Drawer — Clicky panel aesthetic                                 */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="absolute inset-x-0 bottom-0 z-50 px-4 transition-transform duration-300"
        style={{
          transform: drawerOpen ? "translateY(0)" : "translateY(100%)",
        }}
      >
        <div
          className="mx-auto max-w-lg rounded-t-2xl border-t border-x border-white/10 px-5 py-5"
          style={{
            background: "#181818",
            boxShadow: "0 -24px 60px rgba(0,0,0,0.6), 0 -2px 0 rgba(255,255,255,0.05)",
          }}
        >
          {/* Drag handle */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {/* Dot like Clicky's status dot */}
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: answer || isCheckpoint
                    ? "var(--cursor-blue)"
                    : "rgba(255,255,255,0.2)",
                  boxShadow: answer || isCheckpoint
                    ? "0 0 6px var(--cursor-blue-glow)"
                    : "none",
                }}
              />
              <p className="text-sm font-semibold text-white/80">
                {answer ? "Tutor response" : isCheckpoint ? "Your turn" : "Ask a question"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/6 text-white/35 transition hover:bg-white/12 hover:text-white/65"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {answer ? (
            /* Answer view */
            <div className="space-y-4">
              <div
                className="max-h-[42vh] overflow-y-auto rounded-xl px-4 py-4 text-sm leading-7 text-white/72"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "0.5px solid rgba(255,255,255,0.08)",
                }}
              >
                <MarkdownLite text={answer} />
                {answerSources.length ? (
                  <div className="mt-4 border-t border-white/10 pt-3 text-xs text-white/45" aria-label="Answer sources">
                    <span className="font-semibold text-white/65">Source-grounded in: </span>
                    {answerSources.map((source) => `Slide ${source.slideNumber}: ${source.title}`).join(" · ")}
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void onSpeakAnswer(answer)}
                  disabled={isSpeakingAnswer}
                  className="flex-1 rounded-full py-2.5 text-sm font-semibold text-white/75 transition disabled:cursor-not-allowed disabled:opacity-45"
                  style={{
                    background: "rgba(255,255,255,0.09)",
                  }}
                >
                  {isSpeakingAnswer ? "Speaking…" : "Replay answer"}
                </button>
                <button
                  type="button"
                  onClick={handleResume}
                  className="flex-[1.3] rounded-full py-2.5 text-sm font-semibold text-white transition"
                  style={{
                    background: "var(--cursor-blue)",
                    boxShadow: "0 0 16px var(--cursor-blue-glow)",
                  }}
                >
                  Ready to continue
                </button>
              </div>
            </div>
          ) : (
            /* Question input view — Clicky text field style */
            <div className="space-y-3">
              {isCheckpoint ? (
                <div
                  className="rounded-xl border border-[var(--cursor-blue)]/30 bg-[var(--cursor-blue-bg)] px-4 py-3"
                  aria-live="polite"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--cursor-blue)]">
                    Checkpoint question
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/85">
                    {checkpointQuestion}
                  </p>
                  <p className="mt-2 text-xs text-white/45">
                    Write your thinking below. The professor will respond, then you can continue.
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 rounded-full bg-white/6 p-1">
                {(["text", "realtime"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => mode === "realtime" ? handleRealtimeMode() : setInputMode("text")}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold transition"
                    style={{
                      background:
                        inputMode === mode
                          ? "rgba(255,255,255,0.14)"
                          : "transparent",
                      color:
                        inputMode === mode
                          ? "rgba(255,255,255,0.82)"
                          : "rgba(255,255,255,0.38)",
                    }}
                  >
                    {mode === "realtime" ? "Realtime tutor" : "Text"}
                  </button>
                ))}
              </div>
              {inputMode === "realtime" ? (
                <div
                  className="rounded-xl px-4 py-5"
                  style={{
                    background: realtimeActive
                      ? "var(--cursor-blue-bg)"
                      : "rgba(255,255,255,0.07)",
                    border: "0.5px solid rgba(255,255,255,0.10)",
                  }}
                  aria-live="polite"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        background: realtimeActive
                          ? "#4ade80"
                          : realtimeState === "error"
                            ? "#fbbf24"
                            : "var(--cursor-blue)",
                        boxShadow: realtimeActive
                          ? "0 0 10px rgba(74,222,128,0.7)"
                          : "0 0 10px var(--cursor-blue-glow)",
                      }}
                    />
                    <div>
                      <p className="text-sm font-semibold text-white/85">
                        {realtimeState === "speaking"
                          ? "Professor is speaking"
                          : realtimeState === "working"
                            ? "Professor is using a tool"
                            : realtimeState === "connected"
                              ? "Realtime tutor is listening"
                              : realtimeState === "connecting"
                                ? "Connecting realtime tutor..."
                                : realtimeState === "error"
                                  ? "Realtime tutor needs attention"
                                  : "Switching to realtime tutor..."}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-white/45">
                        {realtimeActive
                          ? "Speak naturally. You can interrupt, ask follow-ups, or ask the professor to use the board."
                          : realtimeState === "error"
                            ? "The regular text tutor is still available, or try realtime again."
                            : "Your microphone will turn on automatically; there is no separate listen button."}
                      </p>
                    </div>
                  </div>
                  {realtimeState === "error" ? (
                    <button
                      type="button"
                      onClick={onActivateRealtime}
                      className="mt-4 rounded-full bg-[var(--cursor-blue)] px-4 py-2 text-xs font-semibold text-white shadow-[0_0_12px_var(--cursor-blue-glow)]"
                    >
                      Try realtime again
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="relative">
                  <textarea
                  ref={textareaRef}
                  value={questionDraft}
                  onChange={(e) => setQuestionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      void handleAsk();
                    }
                  }}
                  placeholder={
                    isCheckpoint
                      ? "Type your reasoning here…"
                      : "What do you want to understand better?"
                  }
                  rows={4}
                  className="w-full resize-none rounded-xl px-4 py-3 pr-14 text-sm leading-7 text-white/80 outline-none transition"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "0.5px solid rgba(255,255,255,0.10)",
                    caretColor: "var(--cursor-blue)",
                  }}
                  />
                  <button
                    type="button"
                    onClick={toggleListening}
                    className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full transition"
                    style={{
                      background: isListening ? "var(--cursor-blue)" : "rgba(255,255,255,0.1)",
                      color: isListening ? "#fff" : "rgba(255,255,255,0.55)",
                      boxShadow: isListening ? "0 0 12px var(--cursor-blue-glow)" : "none",
                    }}
                    aria-label={isListening ? "Stop transcription" : "Start voice transcription"}
                    title={isListening ? "Stop transcription" : "Transcribe with microphone"}
                  >
                    {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                </div>
              )}
              {(questionError || voiceError) && (
                <p className="text-xs text-amber-400">{questionError || voiceError}</p>
              )}
              {inputMode === "text" && hasBoardContent ? (
                <label className="flex items-center gap-2 text-xs text-white/40">
                  <input
                    type="checkbox"
                    checked={includeBoardImage}
                    onChange={(event) => setIncludeBoardImage(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--cursor-blue)]"
                  />
                  Include a board image for visual inspection
                </label>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="hidden">
                  {inputMode === "text"
                    ? "⌘ + Enter to send"
                    : isListening
                      ? "Listening now… tap to stop"
                      : "Tap the microphone, then send"}
                </span>
                <span className="hidden">
                  {inputMode === "text"
                    ? isListening
                      ? "Listening now — tap mic to stop"
                      : "Use the mic to transcribe, then send"
                    : realtimeActive
                      ? "Speak naturally — the tutor detects your turn"
                      : "Connecting realtime tutor…"}
                </span>
                <span className="text-xs text-white/20">
                  {inputMode === "text"
                    ? isListening
                      ? "Listening now - tap mic to stop"
                      : "Use the mic to transcribe, then send"
                    : realtimeActive
                      ? "Speak naturally - the tutor detects your turn"
                      : "Connecting realtime tutor..."}
                </span>
                <button
                  type="button"
                  onClick={handleAsk}
                  disabled={isSubmittingQuestion || !questionDraft.trim()}
                  className={`rounded-full px-5 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-35 ${inputMode === "realtime" ? "hidden" : ""}`}
                  style={{
                    background: questionDraft.trim()
                      ? "var(--cursor-blue)"
                      : "rgba(255,255,255,0.10)",
                    boxShadow: questionDraft.trim()
                      ? "0 0 12px var(--cursor-blue-glow)"
                      : "none",
                  }}
                >
                  {isSubmittingQuestion ? "Thinking…" : isCheckpoint ? "Send response" : "Ask"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="absolute inset-0 z-40 bg-black/20"
          onClick={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}

type ReviewItem = {
  id: string;
  conceptKey: string;
  prompt: string;
  dueAt: string;
  latestOutcome?: string | null;
};

function RecallPopover({
  items,
  busyId,
  onClose,
  onOutcome,
}: {
  items: ReviewItem[];
  busyId: string | null;
  onClose: () => void;
  onOutcome: (item: ReviewItem, outcome: "correct" | "incorrect") => Promise<void>;
}) {
  return (
    <aside className="absolute right-4 top-14 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#181818] p-4 shadow-2xl" aria-label="Active recall queue">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white/80">Active recall</p>
          <p className="mt-0.5 text-[11px] text-white/35">One honest answer beats another passive replay.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full bg-white/6 px-2 py-1 text-xs text-white/40 hover:text-white/70">Close</button>
      </div>
      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/8 bg-white/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--cursor-blue)]">{item.conceptKey}</p>
              <p className="mt-2 text-sm leading-6 text-white/75">{item.prompt}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void onOutcome(item, "incorrect")}
                  className="rounded-lg bg-white/6 px-2 py-2 text-xs text-white/45 hover:bg-white/10 hover:text-white/70 disabled:opacity-40"
                >
                  Need another pass
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void onOutcome(item, "correct")}
                  className="rounded-lg bg-[var(--cursor-blue-bg)] px-2 py-2 text-xs font-semibold text-white/75 hover:bg-[var(--cursor-blue)] disabled:opacity-40"
                >
                  I can explain it
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-white/[0.04] px-3 py-4 text-sm leading-6 text-white/45">You are caught up. The professor will add a review card when it sees a misconception or teach-back.</p>
      )}
    </aside>
  );
}

function TeachingSettingsPopover({
  teachingFormat,
  customInstructions,
  onChange,
  onClose,
}: {
  teachingFormat: TeachingFormat;
  customInstructions: string;
  onChange: (settings: {
    teachingFormat: TeachingFormat;
    customInstructions: string;
  }) => void;
  onClose: () => void;
}) {
  const formats: Array<{
    value: TeachingFormat;
    label: string;
    description: string;
  }> = [
    {
      value: "lecture",
      label: "Lecture",
      description: "Minimal interruptions",
    },
    {
      value: "small_class",
      label: "Small-class",
      description: "Moderate check-ins",
    },
    {
      value: "tutoring",
      label: "1-1 tutoring",
      description: "Frequent follow-ups",
    },
  ];

  return (
    <div className="absolute right-4 top-14 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#181818] p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-white/80">Teaching format</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/6 px-2 py-1 text-xs text-white/40 transition hover:text-white/70"
        >
          Close
        </button>
      </div>
      <div className="grid gap-2">
        {formats.map((format) => {
          const active = teachingFormat === format.value;
          return (
            <button
              key={format.value}
              type="button"
              onClick={() =>
                onChange({
                  teachingFormat: format.value,
                  customInstructions,
                })
              }
              className="rounded-xl border px-3 py-2 text-left transition"
              style={{
                borderColor: active
                  ? "var(--cursor-blue)"
                  : "rgba(255,255,255,0.08)",
                background: active
                  ? "var(--cursor-blue-bg)"
                  : "rgba(255,255,255,0.04)",
              }}
            >
              <span className="block text-xs font-semibold text-white/80">
                {format.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-white/35">
                {format.description}
              </span>
            </button>
          );
        })}
      </div>
      <label className="mt-4 block">
        <span className="text-xs font-medium text-white/40">
          Custom instructions
        </span>
        <textarea
          value={customInstructions}
          onChange={(event) =>
            onChange({
              teachingFormat,
              customInstructions: event.target.value,
            })
          }
          rows={4}
          maxLength={2000}
          placeholder="Focus on derivations, ask me checkpoint questions, move slowly through equations..."
          className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm leading-6 text-white/75 outline-none placeholder:text-white/25 focus:border-[var(--cursor-blue)]"
        />
      </label>
    </div>
  );
}

function SpeedSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (speed: number) => void;
}) {
  const speeds = [0.9, 0.95, 1, 1.03, 1.06, 1.1, 1.15];
  const rounded = Math.round(value * 100) / 100;

  return (
    <label className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-white/40">
      <span>Speed</span>
      <select
        value={rounded}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-md border border-white/8 bg-white/6 px-2 py-1 text-xs text-white/70 outline-none"
        aria-label="Speech speed"
      >
        {speeds.map((speed) => (
          <option key={speed} value={speed} className="bg-[#181818]">
            {speed}x
          </option>
        ))}
      </select>
    </label>
  );
}

function MarkdownLite({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      {text.split(/\n{2,}/).map((block, index) => {
        const trimmed = block.trim();

        if (!trimmed) {
          return null;
        }

        if (/^[-*]\s+/m.test(trimmed)) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {trimmed
                .split("\n")
                .map((line) => line.replace(/^[-*]\s+/, "").trim())
                .filter(Boolean)
                .map((line, itemIndex) => (
                  <li key={itemIndex}>{line}</li>
                ))}
            </ul>
          );
        }

        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  0?: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = {
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
