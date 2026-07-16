"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { LectureDeck } from "@/lib/aiprof-types";
import { LectureStudio } from "@/components/lecture-studio";

export function SessionPlayer({
  sessionId,
  lectureDeck,
  initialSlideIndex,
  initialCueIndex,
  initialTeachingFormat,
  initialCustomInstructions,
  initialBoardSnapshot,
  initialBoardVersion,
}: {
  sessionId: string;
  lectureDeck: LectureDeck;
  initialSlideIndex: number;
  initialCueIndex: number;
  initialTeachingFormat: "lecture" | "small_class" | "tutoring";
  initialCustomInstructions: string;
  initialBoardSnapshot?: string;
  initialBoardVersion?: number;
}) {
  const router = useRouter();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  const eventSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/sessions/${sessionId}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { lastProgressSeq?: unknown } | null) => {
        if (cancelled) return;
        if (typeof payload?.lastProgressSeq === "number" && Number.isSafeInteger(payload.lastProgressSeq)) {
          eventSeqRef.current = Math.max(eventSeqRef.current, payload.lastProgressSeq);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionId]);

  // Track progress for saving
  const progressRef = useRef({
    currentSlide: initialSlideIndex,
    currentCue: initialCueIndex,
    totalSlides: lectureDeck.totalSlides,
  });

  const buildProgressPayload = useCallback(
    (
      slideIndex: number,
      cueIndex: number,
      status: "active" | "paused" | "completed",
    ) => {
      const percent = Math.round(
        ((slideIndex + 1) / lectureDeck.totalSlides) * 100
      );

      return {
        currentSlide: slideIndex,
        currentCue: cueIndex,
        progressPercent: status === "completed" ? 100 : Math.min(percent, 99),
        status,
        completedAt: status === "completed" ? new Date().toISOString() : null,
      };
    },
    [lectureDeck.totalSlides]
  );

  const saveProgress = useCallback(
    async (
      slideIndex: number,
      cueIndex: number,
      status: "active" | "paused" | "completed" = "active",
    ) => {
      saveAbortRef.current?.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      const eventSeq = ++eventSeqRef.current;

      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildProgressPayload(slideIndex, cueIndex, status),
            eventSeq,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          console.error("[session] failed to save progress", e);
        }
      }
    },
    [buildProgressPayload, sessionId]
  );

  const debouncedSave = useCallback(
    (slideIndex: number, cueIndex: number) => {
      progressRef.current = {
        currentSlide: slideIndex,
        currentCue: cueIndex,
        totalSlides: lectureDeck.totalSlides,
      };
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveProgress(slideIndex, cueIndex);
      }, 2000);
    },
    [saveProgress, lectureDeck.totalSlides]
  );

  const handleEndSession = useCallback(async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveAbortRef.current?.abort();
    const { currentSlide, currentCue } = progressRef.current;
    const hasReachedFinalSlide = currentSlide >= lectureDeck.totalSlides - 1;

    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildProgressPayload(
            currentSlide,
            currentCue,
            hasReachedFinalSlide ? "completed" : "paused",
          ),
          eventSeq: ++eventSeqRef.current,
        }),
      });
    } catch (e) {
      console.error("[session] failed to end session", e);
    }
    router.push("/dashboard");
  }, [buildProgressPayload, lectureDeck.totalSlides, sessionId, router]);

  // Save on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { currentSlide, currentCue } = progressRef.current;
      fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          ...buildProgressPayload(currentSlide, currentCue, "paused"),
          eventSeq: ++eventSeqRef.current,
        }),
      }).catch(() => undefined);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveAbortRef.current?.abort();
    };
  }, [buildProgressPayload, sessionId]);

  return (
    <LectureStudio
      lectureDeck={lectureDeck}
      initialSlideIndex={initialSlideIndex}
      initialCueIndex={initialCueIndex}
      initialTeachingFormat={initialTeachingFormat}
      initialCustomInstructions={initialCustomInstructions}
      initialBoardSnapshot={initialBoardSnapshot}
      initialBoardVersion={initialBoardVersion}
      autoStart
      sessionId={sessionId}
      onSlideChange={debouncedSave}
      onEndSession={handleEndSession}
    />
  );
}
