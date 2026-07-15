"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type {
  LectureCue,
  LectureDeck,
  LectureSlide,
  TeachingFormat,
  WhiteboardContent,
} from "@/lib/aiprof-types";
import type { TeachingFocus } from "@/lib/whiteboard-types";
import { WhiteboardPanel } from "@/components/whiteboard-panel";
import type { WhiteboardTldrawHandle } from "@/components/whiteboard-tldraw";

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
  onAskQuestion: (question: string) => Promise<void>;
  onResume: () => void;
  onSpeakAnswer: (answer: string) => Promise<void>;
  isAnswering: boolean;
  isSpeakingAnswer: boolean;
  answer: string;
  questionError: string;
  liveStatus: string;
  liveError: string;
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
  questionError,
  liveStatus,
  liveError,
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
  onWhiteboardClose,
  onToggleAudioPause,
  onEndSession,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [questionDraft, setQuestionDraft] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [displayedCue, setDisplayedCue] = useState<LectureCue | null>(activeCue);
  const [cursorVisible, setCursorVisible] = useState(Boolean(activeCue));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cursorHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorFrameRef = useRef<number | null>(null);

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
    if (!questionDraft.trim()) return;
    await onAskQuestion(questionDraft.trim());
  }

  function handleResume() {
    recognitionRef.current?.stop();
    setIsListening(false);
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
    isAnswering ? "#d97706" : isLive ? "#4ade80" : "rgba(255,255,255,0.25)";

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
              boxShadow: isLive && !isAnswering
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
            {liveStatus === "speaking" ? "professor speaking" : liveStatus}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <SpeedSelect value={speechSpeed} onChange={onSpeedChange} />
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

              {showWhiteboard ? (
                <WhiteboardPanel
                  content={whiteboardContent}
                  canvasRef={canvasRef}
                  status={whiteboardStatus}
                  onClose={onWhiteboardClose}
                  className="h-[min(68vh,calc(100vh-13rem))]"
                />
              ) : null}

              <div className="col-span-full flex w-full items-center justify-between gap-4 text-xs text-white/35">
                <div className="min-w-0">
                  <p className="truncate text-white/60">
                    {activeSlide?.title ?? "Waiting for lecture"}
                  </p>
                  {activeCue && isLive && !isAnswering ? (
                    <p className="mt-1 truncate">{activeCue.emphasis}</p>
                  ) : null}
                  {isAnswering ? (
                    <p className="mt-1">Lecture paused while answering.</p>
                  ) : null}
                  {liveError ? (
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
                  background: answer
                    ? "var(--cursor-blue)"
                    : "rgba(255,255,255,0.2)",
                  boxShadow: answer
                    ? "0 0 6px var(--cursor-blue-glow)"
                    : "none",
                }}
              />
              <p className="text-sm font-semibold text-white/80">
                {answer ? "Tutor response" : "Ask a question"}
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
              <div className="grid grid-cols-2 gap-2 rounded-full bg-white/6 p-1">
                {(["voice", "text"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setInputMode(mode)}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition"
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
                    {mode}
                  </button>
                ))}
              </div>
              {inputMode === "voice" ? (
                <button
                  type="button"
                  onClick={toggleListening}
                  className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl px-4 py-5 text-center transition"
                  style={{
                    background: isListening
                      ? "var(--cursor-blue-bg)"
                      : "rgba(255,255,255,0.07)",
                    border: "0.5px solid rgba(255,255,255,0.10)",
                    color: isListening
                      ? "rgba(255,255,255,0.9)"
                      : "rgba(255,255,255,0.62)",
                  }}
                >
                  <span className="mb-2 text-xl">{isListening ? "Listening" : "Tap to ask aloud"}</span>
                  <span className="max-w-sm text-xs leading-5 text-white/35">
                    {questionDraft || "Your transcript will appear here before you send it."}
                  </span>
                </button>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={questionDraft}
                  onChange={(e) => setQuestionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      void handleAsk();
                    }
                  }}
                  placeholder="What do you want to understand better?"
                  rows={4}
                  className="w-full resize-none rounded-xl px-4 py-3 text-sm leading-7 text-white/80 outline-none transition"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "0.5px solid rgba(255,255,255,0.10)",
                    caretColor: "var(--cursor-blue)",
                  }}
                />
              )}
              {(questionError || voiceError) && (
                <p className="text-xs text-amber-400">{questionError || voiceError}</p>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-white/20">
                  {inputMode === "text" ? "⌘ + Enter to send" : "Stop speaking, then send"}
                </span>
                <button
                  type="button"
                  onClick={handleAsk}
                  disabled={isAnswering || !questionDraft.trim()}
                  className="rounded-full px-5 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-35"
                  style={{
                    background: questionDraft.trim()
                      ? "var(--cursor-blue)"
                      : "rgba(255,255,255,0.10)",
                    boxShadow: questionDraft.trim()
                      ? "0 0 12px var(--cursor-blue-glow)"
                      : "none",
                  }}
                >
                  {isAnswering ? "Answering…" : "Ask"}
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
