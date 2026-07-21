"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Hand,
  Mic,
  MicOff,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { LectureDeck } from "@/lib/aiprof-types";
import type { TutorInkPlan, ProbeRegion } from "@/components/notebook-probe/probe-types";
import {
  TldrawProbeCanvas,
  type NotebookCanvasPage,
  type NotebookCanvasTool,
  type TldrawProbeCanvasHandle,
} from "@/components/notebook-probe/tldraw-probe-canvas";
import {
  useRealtimePerformance,
  type RealtimeTranscriptEvent,
} from "@/components/notebook-probe/use-realtime-performance";

type PageMap = { imageDataUrl: string; regions: ProbeRegion[]; focusedRegionId?: string };
type AuthorIntent = "explain" | "check_work";

export function NotebookSurface({
  decks,
  initialDeckId,
}: {
  decks: LectureDeck[];
  initialDeckId?: string;
}) {
  const [deckId, setDeckId] = useState(initialDeckId ?? decks[0]?.deckId ?? "");
  const deck = decks.find((candidate) => candidate.deckId === deckId) ?? decks[0];
  const pages = useMemo<NotebookCanvasPage[]>(() => (deck?.slides ?? []).map((slide) => ({
    id: slide.id,
    title: slide.title || `Page ${slide.slideNumber}`,
    imageUrl: slide.imageUrl,
    pageNumber: slide.slideNumber,
  })), [deck]);
  const [activePageId, setActivePageId] = useState(pages[0]?.id ?? "");
  const [tool, setToolState] = useState<NotebookCanvasTool>("select");
  const [error, setError] = useState("");
  const [deckMenuOpen, setDeckMenuOpen] = useState(false);
  const canvasRef = useRef<TldrawProbeCanvasHandle | null>(null);
  const pageMapsRef = useRef(new Map<string, PageMap>());
  const [regionsByPage, setRegionsByPage] = useState<Record<string, ProbeRegion[]>>({});
  const mapPromisesRef = useRef(new Map<string, Promise<PageMap>>());
  const activePlanRef = useRef<TutorInkPlan | null>(null);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const activeRegions = activePage ? regionsByPage[activePage.id] ?? [] : [];

  const ensurePageMap = useCallback(async (
    page: NotebookCanvasPage,
    question = "Map the meaningful visual, text, and formula regions on this study page.",
    refresh = false,
    imageOverride?: string,
  ): Promise<PageMap> => {
    const cached = refresh ? undefined : pageMapsRef.current.get(page.id);
    if (cached && !imageOverride) return cached;
    const inFlight = refresh || imageOverride ? undefined : mapPromisesRef.current.get(page.id);
    if (inFlight) return inFlight;

    const mapping = (async () => {
      const visionQuestion = question.slice(0, 500);
      let imageDataUrl = await compactImage(imageOverride ?? page.imageUrl);
      imageDataUrl = normalizeImageDataUrl(imageDataUrl);
      const response = await fetch("/api/notebook/probe/vision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl, question: visionQuestion }),
      });
      const payload = await response.json().catch(() => ({})) as { regions?: unknown; focusedRegionId?: unknown };
      if (!response.ok) throw new Error("PAGE_READ_FAILED");
      const regions = Array.isArray(payload.regions) ? payload.regions.filter(isProbeRegion) : [];
      const result = {
        imageDataUrl,
        regions,
        focusedRegionId: typeof payload.focusedRegionId === "string" ? payload.focusedRegionId : undefined,
      };
      // Cache the base page map (not composite overrides) so later turns stay fast.
      if (!imageOverride) {
        pageMapsRef.current.set(page.id, result);
        setRegionsByPage((current) => ({ ...current, [page.id]: regions }));
      }
      return result;
    })().finally(() => {
      if (!refresh && !imageOverride) mapPromisesRef.current.delete(page.id);
    });
    if (!refresh && !imageOverride) mapPromisesRef.current.set(page.id, mapping);
    return mapping;
  }, []);

  const authorPlan = useCallback(async (question: string) => {
    const canvasPageId = canvasRef.current?.getActivePageId();
    const page =
      (canvasPageId ? pages.find((candidate) => candidate.id === canvasPageId) : undefined)
      ?? activePage;
    if (!page) throw new Error("Upload a PDF before starting a session.");
    if (page.id !== activePageId) setActivePageId(page.id);

    const composite = await Promise.race([
      canvasRef.current?.exportActivePageComposite().catch(() => null) ?? Promise.resolve(null),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2_500)),
    ]);
    const hasLearnerInk = Boolean(composite?.hasLearnerInk ?? canvasRef.current?.hasLearnerInk());
    const intent = detectAuthorIntent(question, hasLearnerInk);

    // Prefer a compact snapshot of the visible page (with learner marks when present).
    let groundImage: string | undefined;
    try {
      groundImage = await compactImage(composite?.imageDataUrl ?? page.imageUrl);
      groundImage = normalizeImageDataUrl(groundImage);
    } catch {
      groundImage = undefined;
    }

    // Use cached regions when possible. Only re-scan when the learner marked the page.
    let pageMap: PageMap | null = null;
    try {
      pageMap = await ensurePageMap(page);
    } catch {
      pageMap = pageMapsRef.current.get(page.id) ?? null;
    }

    if (hasLearnerInk && groundImage) {
      try {
        const marked = await ensurePageMap(
          page,
          "Map printed problems and learner marks or arrows on this page.",
          true,
          groundImage,
        );
        pageMap = {
          ...marked,
          // Keep printed-page regions if the marked scan returns nothing useful.
          regions: marked.regions.length ? marked.regions : pageMap?.regions ?? [],
          focusedRegionId: marked.focusedRegionId ?? pageMap?.focusedRegionId,
        };
      } catch {
        // Author can still work from the image alone.
      }
    }

    if (!pageMap) {
      pageMap = {
        imageDataUrl: groundImage ?? await compactImage(page.imageUrl).then(normalizeImageDataUrl),
        regions: [],
      };
    } else if (groundImage) {
      pageMap = { ...pageMap, imageDataUrl: groundImage };
    }

    const inkSummary = hasLearnerInk
      ? `The learner marked the page with ${composite?.learnerStrokeCount ?? "some"} strokes (arrows or writing). Treat those marks as the focus of their question.`
      : `Page ${page.pageNumber}: ${page.title}. No learner marks yet.`;

    const contextualQuestion = [
      `The learner is looking at page ${page.pageNumber} (${page.title}).`,
      hasLearnerInk ? "They already pointed or drew on the page. Answer the marked problem; do not ask them to point again." : "",
      `Learner said: ${question}`,
    ].filter(Boolean).join(" ");

    let authored = await requestAuthoredPlan(contextualQuestion, pageMap, {
      existingInkSummary: inkSummary,
      hasLearnerInk,
      intent,
      pageNumber: page.pageNumber,
      pageTitle: page.title,
    });
    if (!authored && pageMap.regions.length === 0) {
      // One retry with a fresh page scan if we had no regions at all.
      try {
        pageMap = await ensurePageMap(page, "Map the problems and formulas on this page.", true);
        if (groundImage) pageMap = { ...pageMap, imageDataUrl: groundImage };
        authored = await requestAuthoredPlan(contextualQuestion, pageMap, {
          existingInkSummary: inkSummary,
          hasLearnerInk,
          intent,
          pageNumber: page.pageNumber,
          pageTitle: page.title,
        });
      } catch {
        // Fall through to a local fallback.
      }
    }

    const plan = authored ?? createGroundedFallbackPlan(question, pageMap, intent, page);
    if (!plan) {
      // Last resort: still teach from open space even with no regions.
      const emergency: TutorInkPlan = {
        id: crypto.randomUUID(),
        summary: `Help on page ${page.pageNumber}`,
        narrationBrief: "Start a short handwritten solution for the problem the learner asked about.",
        beats: [
          {
            id: "write-1",
            atMs: 0,
            durationMs: 1_400,
            voiceCue: "I'll work this out below.",
            action: { type: "write", text: "let's solve this", x: 0.1, y: 0.7, color: "blue" },
          },
        ],
      };
      canvasRef.current?.clearTutorInk();
      if (!canvasRef.current?.beginTutorPerformance(emergency)) throw new Error("The notebook is not ready yet.");
      activePlanRef.current = emergency;
      return emergency;
    }

    canvasRef.current?.clearTutorInk();
    if (!canvasRef.current?.beginTutorPerformance(plan)) throw new Error("The notebook is not ready yet.");
    activePlanRef.current = plan;
    return plan;
  }, [activePage, activePageId, ensurePageMap, pages]);

  const realtime = useRealtimePerformance({
    createPlan: authorPlan,
    onBeatCue: (planId, beatId, cueTimestamp) => {
      canvasRef.current?.renderTutorBeat(planId, beatId, cueTimestamp);
    },
    onInterrupted: ({ planId }) => canvasRef.current?.cancelTutorPerformance(planId),
    onTranscript: (event: RealtimeTranscriptEvent) => {
      if (event.direction === "learner" && event.final) setError("");
    },
    onState: (state) => {
      if (state.error) setError(state.error);
    },
  });

  const chooseDeck = useCallback((nextDeckId: string) => {
    const nextDeck = decks.find((candidate) => candidate.deckId === nextDeckId);
    if (!nextDeck) return;
    realtime.disconnect();
    activePlanRef.current = null;
    setDeckId(nextDeckId);
    setActivePageId(nextDeck.slides[0]?.id ?? "");
    setDeckMenuOpen(false);
    setError("");
    window.history.replaceState(null, "", `/notebook?deck=${encodeURIComponent(nextDeckId)}`);
  }, [decks, realtime]);

  const choosePage = useCallback((pageId: string, options?: { zoom?: boolean }) => {
    const page = pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    setActivePageId((current) => (current === pageId ? current : pageId));
    if (options?.zoom !== false) canvasRef.current?.zoomToPage(pageId);
  }, [pages]);

  const handleActivePageChange = useCallback((pageId: string) => {
    choosePage(pageId, { zoom: false });
  }, [choosePage]);

  const setTool = useCallback((nextTool: NotebookCanvasTool) => {
    setToolState(nextTool);
    canvasRef.current?.setTool(nextTool);
  }, []);

  const startSession = useCallback(async () => {
    if (!activePage) return;
    setError("");
    try {
      await realtime.connect();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Voice is unavailable right now.");
    }
  }, [activePage, realtime]);

  const pauseSession = useCallback(() => {
    realtime.interrupt();
    realtime.disconnect();
    canvasRef.current?.cancelTutorPerformance(activePlanRef.current?.id);
  }, [realtime]);

  const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePage?.id));
  const isSessionActive = realtime.state.connected;
  const sessionBusy = realtime.state.status === "connecting" || realtime.state.status === "thinking";
  const statusLabel = sessionStatusLabel(realtime.state.status, isSessionActive);

  return (
    <main className="relative flex h-dvh min-h-[600px] flex-col overflow-hidden bg-[#111] text-white">
      <header className="relative z-40 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#111] px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-1">
          <Link href="/dashboard" aria-label="Back to library" className="grid size-8 shrink-0 place-items-center rounded-md text-white/45 transition hover:bg-white/[0.06] hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cursor-blue)]">
            <ArrowLeft className="size-4" />
          </Link>
          <span className={`ml-1 size-2 shrink-0 rounded-full ${isSessionActive ? "bg-emerald-400" : "bg-white/20"}`} aria-hidden />
          <span className="ml-2 hidden text-sm font-semibold tracking-tight text-white/90 sm:inline">studydeck</span>
          <span className="mx-2 hidden text-white/15 sm:inline">/</span>
          <div className="relative min-w-0">
            <button type="button" onClick={() => setDeckMenuOpen((open) => !open)} className="flex max-w-[15rem] items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white/85" aria-expanded={deckMenuOpen}>
              <span className="truncate">{deck?.deckTitle ?? "Notebook"}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </button>
            {deckMenuOpen ? (
              <div className="absolute left-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-white/10 bg-[#191919] py-1 shadow-[0_8px_8px_rgba(0,0,0,0.28)]">
                {decks.map((candidate) => (
                  <button key={candidate.deckId} type="button" onClick={() => chooseDeck(candidate.deckId)} className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-white/[0.06] ${candidate.deckId === deck?.deckId ? "text-white" : "text-white/55"}`}>
                    <span className="block truncate">{candidate.deckTitle}</span>
                    <span className="mt-0.5 block text-xs text-white/30">{candidate.slides.length} pages</span>
                  </button>
                ))}
                <Link href="/deck/new" className="mt-1 flex items-center gap-2 border-t border-white/[0.06] px-3 py-2.5 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white/85">
                  <Plus className="size-4" /> Upload PDF
                </Link>
              </div>
            ) : null}
          </div>
          {statusLabel ? (
            <span className="ml-2 hidden truncate text-xs text-white/35 sm:inline" aria-live="polite">{statusLabel}</span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Link href="/deck/new" className="hidden rounded-md px-3 py-1.5 text-xs text-white/45 transition hover:bg-white/[0.06] hover:text-white/75 sm:block">Upload PDF</Link>
          {!isSessionActive ? (
            <button type="button" onClick={() => void startSession()} disabled={!activePage || sessionBusy} className="inline-flex h-8 items-center gap-2 rounded-md bg-white px-3 text-xs font-semibold text-[#111] transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-55">
              <Play className="size-3.5 fill-current" />
              {sessionBusy ? "Starting…" : "Start session"}
            </button>
          ) : (
            <>
              <button type="button" onClick={realtime.state.muted ? realtime.unmute : realtime.mute} aria-label={realtime.state.muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={realtime.state.muted} className={`grid size-8 place-items-center rounded-md transition ${realtime.state.muted ? "bg-red-400/15 text-red-300" : "text-white/55 hover:bg-white/[0.06] hover:text-white/85"}`}>
                {realtime.state.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
              <button type="button" onClick={pauseSession} aria-label="Pause session" className="grid size-8 place-items-center rounded-md text-white/55 transition hover:bg-white/[0.06] hover:text-white/85">
                <Pause className="size-4 fill-current" />
              </button>
              <button type="button" onClick={pauseSession} aria-label="End session" className="grid size-8 place-items-center rounded-md text-white/35 transition hover:bg-red-400/10 hover:text-red-300">
                <Square className="size-3.5 fill-current" />
              </button>
            </>
          )}
        </div>
      </header>

      <section className="relative min-h-0 flex-1">
        {pages.length ? (
          <TldrawProbeCanvas
            key={deck?.deckId}
            ref={canvasRef}
            pages={pages}
            activePageId={activePage?.id}
            regions={activeRegions}
            persistenceKey={`studydeck-notebook-${deck?.deckId}`}
            onActivePageChange={handleActivePageChange}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-base font-medium text-white/80">Upload a problem set to open a notebook</p>
              <p className="mt-2 text-sm text-white/40">PDF worksheets work best. Start a session, then ask about any step.</p>
              <Link href="/deck/new" className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-[#111]"><Plus className="size-4" /> Upload PDF</Link>
            </div>
          </div>
        )}

        {error ? (
          <div role="alert" className="absolute right-4 top-4 z-30 max-w-sm rounded-lg border border-red-300/15 bg-[#1b1515] px-3 py-2 text-xs text-red-200 shadow-[0_8px_8px_rgba(0,0,0,0.25)]">{error}</div>
        ) : null}

        {pages.length && isSessionActive && realtime.state.status === "ready" && tool !== "draw" ? (
          <p className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-md bg-black/45 px-3 py-1.5 text-xs text-white/55 backdrop-blur-sm">
            Ask about a problem, or draw your work and ask the tutor to check it
          </p>
        ) : null}

        {pages.length ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex items-end justify-between gap-3 px-3 sm:px-5">
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-[#171717] p-1 shadow-[0_6px_8px_rgba(0,0,0,0.28)]" aria-label="Canvas tools">
              <ToolButton label="Select" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 className="size-4" /></ToolButton>
              <ToolButton label="Draw" active={tool === "draw"} onClick={() => setTool("draw")}><Pencil className="size-4" /></ToolButton>
              <ToolButton label="Erase" active={tool === "eraser"} onClick={() => setTool("eraser")}><Eraser className="size-4" /></ToolButton>
              <ToolButton label="Pan" active={tool === "hand"} onClick={() => setTool("hand")}><Hand className="size-4" /></ToolButton>
            </div>

            <nav className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-lg border border-white/[0.08] bg-[#171717] p-1 shadow-[0_6px_8px_rgba(0,0,0,0.28)]" aria-label="Notebook pages">
              <button type="button" aria-label="Previous page" disabled={activeIndex === 0} onClick={() => choosePage(pages[activeIndex - 1]?.id)} className="grid size-8 shrink-0 place-items-center rounded-md text-white/45 transition hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-20"><ChevronLeft className="size-4" /></button>
              <span className="min-w-16 px-2 text-center text-xs tabular-nums text-white/45">{activeIndex + 1} / {pages.length}</span>
              <button type="button" aria-label="Next page" disabled={activeIndex >= pages.length - 1} onClick={() => choosePage(pages[activeIndex + 1]?.id)} className="grid size-8 shrink-0 place-items-center rounded-md text-white/45 transition hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-20"><ChevronRight className="size-4" /></button>
            </nav>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ToolButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick} className={`grid size-8 place-items-center rounded-md transition ${active ? "bg-white text-[#111]" : "text-white/45 hover:bg-white/[0.06] hover:text-white/80"}`}>{children}</button>;
}

function sessionStatusLabel(status: string, connected: boolean) {
  if (!connected) return "";
  if (status === "thinking") return "Thinking…";
  if (status === "speaking") return "Speaking";
  if (status === "interrupted") return "Listening";
  if (status === "ready") return "Listening";
  if (status === "connecting") return "Connecting…";
  return "";
}

function detectAuthorIntent(question: string, hasLearnerInk: boolean): AuthorIntent {
  if (/\b(check|look over|review|grade|mark|correct|did i|is this|am i|my work|my answer|tried|finished|done)\b/i.test(question)) {
    return hasLearnerInk ? "check_work" : "explain";
  }
  if (/\b(wrong|mistake|error|stuck on my)\b/i.test(question) && hasLearnerInk) return "check_work";
  return "explain";
}

function normalizeImageDataUrl(dataUrl: string) {
  const trimmed = dataUrl.replace(/\s+/g, "");
  if (/^data:image\/jpg;base64,/i.test(trimmed)) {
    return trimmed.replace(/^data:image\/jpg;base64,/i, "data:image/jpeg;base64,");
  }
  return trimmed;
}

function isProbeRegion(value: unknown): value is ProbeRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Partial<ProbeRegion>;
  const box = region.box;
  return typeof region.id === "string" && typeof region.label === "string" && typeof region.kind === "string" && typeof region.confidence === "number" && Boolean(box) && typeof box?.x === "number" && typeof box?.y === "number" && typeof box?.width === "number" && typeof box?.height === "number";
}

function isTutorInkPlan(value: unknown, planId: unknown): value is TutorInkPlan {
  if (!value || typeof value !== "object" || typeof planId !== "string") return false;
  const plan = value as Partial<TutorInkPlan>;
  const valid = typeof plan.summary === "string" && typeof plan.narrationBrief === "string" && Array.isArray(plan.beats) && plan.beats.every((beat) => {
    const action = beat?.action as { type?: unknown } | undefined;
    return typeof beat?.id === "string" && typeof beat?.atMs === "number" && typeof beat?.durationMs === "number" && typeof beat?.voiceCue === "string" && typeof action?.type === "string";
  });
  if (valid) Object.assign(plan, { id: planId });
  return valid;
}

async function requestAuthoredPlan(
  question: string,
  pageMap: PageMap,
  options: {
    existingInkSummary?: string;
    hasLearnerInk?: boolean;
    intent?: AuthorIntent;
    pageNumber?: number;
    pageTitle?: string;
  },
) {
  const response = await fetch("/api/notebook/probe/author", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: pageMap.imageDataUrl,
      question,
      regions: pageMap.regions,
      focusedRegionIds: pageMap.focusedRegionId ? [pageMap.focusedRegionId] : [],
      existingInkSummary: options.existingInkSummary ?? "The notebook is ready for a new explanation.",
      hasLearnerInk: options.hasLearnerInk ?? false,
      intent: options.intent ?? "explain",
      pageNumber: options.pageNumber,
      pageTitle: options.pageTitle,
    }),
  });
  const payload = await response.json().catch(() => ({})) as { planId?: unknown; plan?: unknown; code?: unknown };
  if (!response.ok || !isTutorInkPlan(payload.plan, payload.planId)) return null;
  return payload.plan;
}

function createGroundedFallbackPlan(
  _question: string,
  pageMap: PageMap,
  intent: AuthorIntent,
  page?: NotebookCanvasPage,
): TutorInkPlan | null {
  const region = pageMap.regions.find((candidate) => candidate.id === pageMap.focusedRegionId) ?? pageMap.regions[0];
  if (!region) return null;
  const pageLabel = page ? `page ${page.pageNumber}` : "this page";
  if (intent === "check_work") {
    return {
      id: crypto.randomUUID(),
      summary: `Check work near ${region.label}`,
      narrationBrief: `Look at the learner's attempt near ${region.label} on ${pageLabel} and walk the next correct step.`,
      beats: [
        {
          id: "focus",
          atMs: 0,
          durationMs: 520,
          voiceCue: `Looking at what you marked near ${region.label}.`,
          action: { type: "circle", targetRegionId: region.id, color: "orange" },
        },
        {
          id: "next",
          atMs: 560,
          durationMs: 900,
          voiceCue: "Let's write the next step here.",
          action: { type: "write", text: "next step...", x: 0.12, y: 0.72, color: "blue" },
        },
      ],
    };
  }
  return {
    id: crypto.randomUUID(),
    summary: `Work ${region.label} on ${pageLabel}`,
    narrationBrief: `Circle the problem the learner asked about on ${pageLabel}, then start a short handwritten solution in the open space below.`,
    beats: [
      {
        id: "focus",
        atMs: 0,
        durationMs: 520,
        voiceCue: `Let's take this problem on ${pageLabel}.`,
        action: { type: "circle", targetRegionId: region.id, color: "violet" },
      },
      {
        id: "start",
        atMs: 560,
        durationMs: 1_200,
        voiceCue: "I'll start the working below.",
        action: { type: "write", text: "working:", x: 0.12, y: 0.68, color: "blue" },
      },
    ],
  };
}

async function compactImage(source: string) {
  const rawDataUrl = normalizeImageDataUrl(source.startsWith("data:") ? source : await urlToDataUrl(source));
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(rawDataUrl) && dataUrlByteLength(rawDataUrl) <= 980_000) return rawDataUrl;
  const image = await loadImage(rawDataUrl);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This page could not be prepared.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.58, 0.45]) {
    const compact = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(compact) <= 980_000) return compact;
  }
  throw new Error("This page is too detailed to read quickly.");
}

async function urlToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("This page could not be loaded.");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("This page could not be read."));
    reader.onerror = () => reject(new Error("This page could not be read."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlByteLength(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return base64.length / 4 * 3 - padding;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This page could not be processed."));
    image.src = src;
  });
}
