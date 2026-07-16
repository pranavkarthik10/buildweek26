"use client";

import { useCallback, useRef, useState } from "react";

type PrepStep = { label: string; done: boolean };

type Props = {
  selectedFile: File | null;
  onFileSelect: (file: File) => void;
  onPrepare: () => void;
  isPreparing: boolean;
  prepPercent: number;
  prepSteps: PrepStep[];
  prepError: string;
  isReady: boolean;
  onStart: () => void;
};

export function UploadScreen({
  selectedFile,
  onFileSelect,
  onPrepare,
  isPreparing,
  prepPercent,
  prepSteps,
  prepError,
  isReady,
  onStart,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.type === "application/pdf") onFileSelect(file);
    },
    [onFileSelect],
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-10 text-center">
          <div className="mb-3 flex items-center justify-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--ink-strong)]">
              studydeck
            </h1>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Upload a lecture deck to get started
          </p>
        </div>

        {!isReady && (
          <div
            role="button"
            tabIndex={0}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter") fileRef.current?.click();
            }}
            className={`mb-5 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
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
        )}

        {selectedFile && !isPreparing && !isReady && (
          <button
            type="button"
            onClick={onPrepare}
            className="mb-5 w-full rounded-lg bg-[var(--ink-strong)] py-3 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
          >
            Prepare lecture
          </button>
        )}

        {isPreparing && (
          <div className="mb-5 space-y-4">
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
          <p className="mb-5 text-center text-sm text-[var(--warn)]">
            {prepError}
          </p>
        )}

        {isReady && (
          <div className="space-y-6 text-center">
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
              <p className="font-medium text-[var(--ink-strong)]">
                Lecture ready
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Your deck has been rendered into a live slide lecture
              </p>
            </div>
            <button
              type="button"
              onClick={onStart}
              className="w-full rounded-lg bg-[var(--ink-strong)] py-3 text-sm font-medium text-[var(--page)] transition hover:opacity-90"
            >
              Start lecture
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
