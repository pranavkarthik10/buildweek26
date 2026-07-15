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
}: {
  sessionId: string;
  lectureDeck: LectureDeck;
  initialSlideIndex: number;
  initialCueIndex: number;
  initialTeachingFormat: "lecture" | "small_class" | "tutoring";
  initialCustomInstructions: string;
}) {
  const router = useRouter();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildProgressPayload(slideIndex, cueIndex, status)),
        });
      } catch (e) {
        console.error("[session] failed to save progress", e);
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
    const { currentSlide, currentCue } = progressRef.current;
    const hasReachedFinalSlide = currentSlide >= lectureDeck.totalSlides - 1;

    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildProgressPayload(
            currentSlide,
            currentCue,
            hasReachedFinalSlide ? "completed" : "paused",
          ),
        ),
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
        body: JSON.stringify(buildProgressPayload(currentSlide, currentCue, "paused")),
      }).catch(() => undefined);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [buildProgressPayload, sessionId]);

  return (
    <LectureStudio
      lectureDeck={lectureDeck}
      initialSlideIndex={initialSlideIndex}
      initialCueIndex={initialCueIndex}
      initialTeachingFormat={initialTeachingFormat}
      initialCustomInstructions={initialCustomInstructions}
      autoStart
      sessionId={sessionId}
      onSlideChange={debouncedSave}
      onEndSession={handleEndSession}
    />
  );
}
