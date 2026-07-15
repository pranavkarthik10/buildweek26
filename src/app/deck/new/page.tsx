"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { LectureDeck, TeachingFormat } from "@/lib/aiprof-types";

const prepStepLabels = [
  "Rendering your PDF slides",
  "Reading your class content",
  "Finding the missing explanations",
  "Building teaching cues",
];

type PrepStep = { label: string; done: boolean };

export default function NewDeckPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [lectureDeck, setLectureDeck] = useState<LectureDeck | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepIndex, setPrepIndex] = useState(0);
  const [prepError, setPrepError] = useState("");
  const [prepPercent, setPrepPercent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [teachingFormat, setTeachingFormat] =
    useState<TeachingFormat>("lecture");
  const [customInstructions, setCustomInstructions] = useState("");

  const prepSteps: PrepStep[] = prepStepLabels.map((label, i) => ({
    label,
    done: lectureDeck != null || (isPreparing && i <= prepIndex),
  }));

  async function handlePrepare() {
    if (!selectedFile) return;

    setIsPreparing(true);
    setLectureDeck(null);
    setPrepError("");
    setPrepIndex(0);
    setPrepPercent(0);

    const interval = window.setInterval(() => {
      setPrepIndex((current) =>
        current >= prepStepLabels.length - 1 ? current : current + 1
      );
      setPrepPercent((p) => Math.min(95, p + 25));
    }, 1200);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/lecture/prepare", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        error?: string;
        lectureDeck?: LectureDeck;
      };

      if (!response.ok || !payload.lectureDeck) {
        throw new Error(payload.error ?? "Failed to prepare lecture.");
      }

      setLectureDeck(payload.lectureDeck);
      setPrepPercent(100);
    } catch (error) {
      setPrepError(
        error instanceof Error ? error.message : "Failed to prepare lecture."
      );
    } finally {
      window.clearInterval(interval);
      setIsPreparing(false);
    }
  }

  async function handleSaveDeck() {
    if (!lectureDeck || !selectedFile) return;
    setSaving(true);
    setSaveError("");

    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: lectureDeck.deckTitle || selectedFile.name.replace(/\.pdf$/i, ""),
          courseName: lectureDeck.courseName || null,
          summary: lectureDeck.summary || null,
          studyStrategy: lectureDeck.studyStrategy || null,
          pdfUrl: lectureDeck.sourceUrl ?? lectureDeck.deckId,
          totalSlides: lectureDeck.totalSlides,
          slides: lectureDeck.slides,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save deck");
      }

      const deck = await res.json();
      // Create a session and redirect
      const sessionRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckId: deck.id,
          teachingFormat,
          customInstructions,
        }),
      });

      if (!sessionRes.ok) throw new Error("Failed to create session");
      const session = await sessionRes.json();
      window.location.href = `/session/${session.id}`;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save deck");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--page)]">
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--page)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center px-6 py-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--ink-strong)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        {!lectureDeck ? (
          <div className="animate-fade-in">
            <div className="mb-10 text-center">
              <h1 className="font-display text-3xl font-semibold text-[var(--ink-strong)]">
                Upload a new deck
              </h1>
              <p className="mt-2 text-[var(--muted)]">
                Drop a PDF and we will turn it into a live lecture.
              </p>
            </div>

            <UploadDropzone
              selectedFile={selectedFile}
              onFileSelect={setSelectedFile}
            />

            {selectedFile && !isPreparing && (
              <button
                onClick={handlePrepare}
                className="mt-6 w-full rounded-lg bg-[var(--ink-strong)] py-3 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
              >
                Prepare lecture
              </button>
            )}

            {isPreparing && (
              <div className="mt-6 space-y-4">
                <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--line)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                    style={{ width: `${prepPercent}%` }}
                  />
                </div>
                <div className="space-y-2.5">
                  {prepSteps.map((step) => (
                    <div
                      key={step.label}
                      className="flex items-center gap-3 text-sm"
                    >
                      {step.done ? (
                        <svg
                          className="h-4 w-4 shrink-0 text-[var(--accent)]"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <span className="block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--line-strong)] border-t-[var(--accent)]" />
                      )}
                      <span
                        className={
                          step.done
                            ? "text-[var(--ink)]"
                            : "text-[var(--muted)]"
                        }
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {prepError && (
              <p className="mt-4 text-center text-sm text-[var(--warn)]">
                {prepError}
              </p>
            )}
          </div>
        ) : (
          <div className="animate-fade-in space-y-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(94,127,102,0.12)]">
              <svg
                className="h-6 w-6 text-[var(--ok)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-[var(--ink-strong)]">
                {lectureDeck.deckTitle}
              </h2>
              <p className="mt-1 text-[var(--muted)]">
                {lectureDeck.totalSlides} slides &middot;{" "}
                {lectureDeck.courseName || "Untitled course"}
              </p>
            </div>
            {lectureDeck.summary && (
              <p className="mx-auto max-w-lg text-sm text-[var(--muted)]">
                {lectureDeck.summary}
              </p>
            )}
            <StartSettings
              teachingFormat={teachingFormat}
              customInstructions={customInstructions}
              onTeachingFormatChange={setTeachingFormat}
              onCustomInstructionsChange={setCustomInstructions}
            />
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={handleSaveDeck}
                disabled={saving}
                className="w-full rounded-lg bg-[var(--ink-strong)] px-8 py-3 text-sm font-medium text-[var(--page)] transition hover:opacity-90 disabled:opacity-50 sm:w-auto"
              >
                {saving ? "Saving..." : "Save & start session"}
              </button>
              <button
                onClick={() => {
                  setLectureDeck(null);
                  setSelectedFile(null);
                }}
                className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-8 py-3 text-sm font-medium text-[var(--ink-strong)] transition hover:bg-[var(--panel-hover)] sm:w-auto"
              >
                Upload different deck
              </button>
            </div>
            {saveError && (
              <p className="text-sm text-[var(--warn)]">{saveError}</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function UploadDropzone({
  selectedFile,
  onFileSelect,
}: {
  selectedFile: File | null;
  onFileSelect: (file: File) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      role="button"
      tabIndex={0}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file?.type === "application/pdf") onFileSelect(file);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onClick={() => fileRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter") fileRef.current?.click();
      }}
      className={`flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
        isDragging
          ? "border-[var(--accent)] bg-[rgba(191,106,53,0.06)]"
          : selectedFile
            ? "border-[var(--ok)] bg-[rgba(94,127,102,0.04)]"
            : "border-[var(--line-strong)] hover:border-[var(--muted)]"
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
        }}
      />

      {selectedFile ? (
        <>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(94,127,102,0.12)]">
            <svg
              className="h-5 w-5 text-[var(--ok)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-[var(--ink-strong)]">
            {selectedFile.name}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">Click to change</p>
        </>
      ) : (
        <>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--panel-alt)]">
            <svg
              className="h-5 w-5 text-[var(--muted)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-[var(--ink-strong)]">
            Drop a PDF here
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">or click to browse</p>
        </>
      )}
    </div>
  );
}

function StartSettings({
  teachingFormat,
  customInstructions,
  onTeachingFormatChange,
  onCustomInstructionsChange,
}: {
  teachingFormat: TeachingFormat;
  customInstructions: string;
  onTeachingFormatChange: (format: TeachingFormat) => void;
  onCustomInstructionsChange: (instructions: string) => void;
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
    <div className="mx-auto w-full max-w-lg rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 text-left">
      <p className="text-sm font-medium text-[var(--ink-strong)]">
        Choose how studydeck should teach
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
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
          onChange={(event) => onCustomInstructionsChange(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Move slowly through equations, ask me checkpoint questions, focus on exam-style examples..."
          className="mt-1 w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--page)] px-3 py-2 text-sm text-[var(--ink-strong)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
        />
      </label>
    </div>
  );
}
