"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { TeachingFormat } from "@/lib/aiprof-types";
import {
  Plus,
  Play,
  RotateCcw,
  BookOpen,
  Clock,
  BarChart3,
  Trash2,
  NotebookPen,
} from "lucide-react";

export type DeckSummary = {
  id: string;
  title: string;
  courseName: string | null;
  totalSlides: number;
  createdAt: string;
  lastSession: {
    id: string;
    status: string;
    currentSlide: number;
    progressPercent: number;
    updatedAt: string;
  } | null;
};

export function DashboardClient({ decks }: { decks: DeckSummary[] }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingDeckId, setStartingDeckId] = useState<string | null>(null);
  const [teachingFormat, setTeachingFormat] =
    useState<TeachingFormat>("lecture");
  const [customInstructions, setCustomInstructions] = useState("");

  async function deleteDeck(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/decks/${id}`, { method: "DELETE" });
      if (res.ok) window.location.reload();
    } finally {
      setDeletingId(null);
    }
  }

  async function startSession(deckId: string) {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deckId,
        teachingFormat,
        customInstructions,
      }),
    });
    if (!res.ok) return;
    const session = await res.json();
    window.location.href = `/session/${session.id}`;
  }

  async function resumeSession(sessionId: string) {
    window.location.href = `/session/${sessionId}`;
  }

  return (
    <div className="min-h-screen bg-[var(--page)]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--page)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <DashboardBrandLogo />
          <div className="flex items-center gap-3">
            <Link
              href="/notebook"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-strong)] transition hover:bg-[var(--panel-hover)] hover:text-[var(--ink-strong)]"
            >
              <NotebookPen className="h-4 w-4" />
              Notebook
            </Link>
            <Link
              href="/deck/new"
              className="flex items-center gap-2 rounded-lg bg-[var(--ink-strong)] px-4 py-2 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              New deck
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Stats */}
        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          <StatCard
            icon={<BookOpen className="h-5 w-5 text-[var(--accent)]" />}
            label="Uploaded content"
            value={decks.length}
          />
          <StatCard
            icon={<Clock className="h-5 w-5 text-[var(--accent)]" />}
            label="In progress"
            value={
              decks.filter((deck) =>
                deck.lastSession &&
                deck.lastSession.status !== "completed"
              ).length
            }
          />
          <StatCard
            icon={<BarChart3 className="h-5 w-5 text-[var(--accent)]" />}
            label="Completed"
            value={
              decks.filter(
                (deck) => deck.lastSession?.status === "completed"
              ).length
            }
          />
        </div>

        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-display text-2xl font-semibold text-[var(--ink-strong)]">
              Your class content
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Resume a lesson, restart a deck, or upload something new.
            </p>
          </div>
        </div>

        {decks.length === 0 ? (
          <EmptyState
            title="No content yet"
            description="Upload your first lecture PDF, slide deck, or class notes to start learning."
            action={
              <Link
                href="/deck/new"
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--ink-strong)] px-5 py-2.5 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Upload content
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="group relative flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 transition hover:border-[var(--line-strong)]"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--panel-alt)]">
                    <BookOpen className="h-5 w-5 text-[var(--accent)]" />
                  </div>
                  <button
                    onClick={() => deleteDeck(deck.id)}
                    disabled={deletingId === deck.id}
                    className="rounded-lg p-2 text-[var(--muted)] opacity-0 transition hover:bg-[var(--warn)]/10 hover:text-[var(--warn)] group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <h3 className="font-display text-lg font-semibold text-[var(--ink-strong)]">
                  {deck.title}
                </h3>
                {deck.courseName && (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {deck.courseName}
                  </p>
                )}
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {deck.totalSlides} slides
                </p>

                <div className="mt-4 flex-1 space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                      style={{
                        width: `${deck.lastSession?.progressPercent ?? 0}%`,
                      }}
                    />
                  </div>
                  <span className="block text-xs text-[var(--muted)]">
                    {getDeckStatus(deck)}
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {deck.lastSession?.status !== "completed" &&
                  deck.lastSession ? (
                    <button
                      onClick={() => resumeSession(deck.lastSession!.id)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--ink-strong)] px-3 py-2 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
                    >
                      <Play className="h-4 w-4" />
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={() => setStartingDeckId(deck.id)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--ink-strong)] px-3 py-2 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
                    >
                      <Play className="h-4 w-4" />
                      Start
                    </button>
                  )}

                  {deck.lastSession && (
                    <button
                      onClick={() => setStartingDeckId(deck.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2 text-sm font-medium text-[var(--ink-strong)] transition hover:bg-[var(--panel-hover)]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restart
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {startingDeckId && (
        <StartLessonModal
          teachingFormat={teachingFormat}
          customInstructions={customInstructions}
          onTeachingFormatChange={setTeachingFormat}
          onCustomInstructionsChange={setCustomInstructions}
          onCancel={() => setStartingDeckId(null)}
          onConfirm={() => startSession(startingDeckId)}
        />
      )}
    </div>
  );
}

function getDeckStatus(deck: DeckSummary) {
  if (!deck.lastSession) return "Not started";
  if (deck.lastSession.status === "completed") return "Completed";
  return `Slide ${deck.lastSession.currentSlide + 1} / ${deck.totalSlides}`;
}

function DashboardBrandLogo() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 text-[var(--ink-strong)] transition hover:text-[var(--accent)]"
      aria-label="studydeck home"
    >
      <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-visible">
        <Image
          src="/brand/studydeck-logo-plain.png"
          alt=""
          width={803}
          height={803}
          className="block h-full w-full object-contain"
          priority
          unoptimized
        />
      </span>
      <span className="font-semibold tracking-tight lowercase">studydeck</span>
    </Link>
  );
}

function StartLessonModal({
  teachingFormat,
  customInstructions,
  onTeachingFormatChange,
  onCustomInstructionsChange,
  onCancel,
  onConfirm,
}: {
  teachingFormat: TeachingFormat;
  customInstructions: string;
  onTeachingFormatChange: (format: TeachingFormat) => void;
  onCustomInstructionsChange: (instructions: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-2xl">
        <div className="mb-5">
          <h2 className="font-display text-xl font-semibold text-[var(--ink-strong)]">
            Choose how studydeck should teach
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            You can change this during the lesson.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {formats.map((format) => {
            const active = teachingFormat === format.value;
            return (
              <button
                key={format.value}
                type="button"
                onClick={() => onTeachingFormatChange(format.value)}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  active
                    ? "border-[var(--accent)] bg-[rgba(191,106,53,0.08)]"
                    : "border-[var(--line)] hover:border-[var(--line-strong)]"
                }`}
              >
                <span className="block text-xs font-semibold text-[var(--ink-strong)]">
                  {format.label}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                  {format.description}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-medium text-[var(--muted)]">
            Custom instructions
          </span>
          <textarea
            value={customInstructions}
            onChange={(event) =>
              onCustomInstructionsChange(event.target.value)
            }
            rows={4}
            maxLength={2000}
            placeholder="Move slowly through equations, quiz me before continuing, focus on exam-style examples..."
            className="mt-1 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--ink-strong)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          />
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-4 py-2 text-sm font-medium text-[var(--ink-strong)] transition hover:bg-[var(--panel-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-[var(--ink-strong)] px-4 py-2 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
          >
            Start lesson
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--panel-alt)]">
        {icon}
      </div>
      <div>
        <p className="font-display text-2xl font-bold text-[var(--ink-strong)]">
          {value}
        </p>
        <p className="text-sm text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--paper)] py-20 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--panel-alt)]">
        <BookOpen className="h-6 w-6 text-[var(--muted)]" />
      </div>
      <h3 className="font-display text-lg font-semibold text-[var(--ink-strong)]">
        {title}
      </h3>
      <p className="mt-1 max-w-sm text-sm text-[var(--muted)]">{description}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}
