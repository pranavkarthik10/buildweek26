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
    title: slide.title || `Slide ${slide.slideNumber}`,
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

  const ensurePageMap = useCallback(async (page: NotebookCanvasPage, question = "Map the meaningful visual, text, and formula regions on this study page.", refresh = false): Promise<PageMap> => {
    const cached = refresh ? undefined : pageMapsRef.current.get(page.id);
    if (cached) return cached;
    const inFlight = refresh ? undefined : mapPromisesRef.current.get(page.id);
    if (inFlight) return inFlight;

    const mapping = (async () => {
      const imageDataUrl = await compactImage(page.imageUrl);
      const response = await fetch("/api/notebook/probe/vision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl, question }),
      });
      const payload = await response.json().catch(() => ({})) as { regions?: unknown; focusedRegionId?: unknown };
      if (!response.ok) throw new Error("This page could not be read yet.");
      const regions = Array.isArray(payload.regions) ? payload.regions.filter(isProbeRegion) : [];
      const result = {
        imageDataUrl,
        regions,
        focusedRegionId: typeof payload.focusedRegionId === "string" ? payload.focusedRegionId : undefined,
      };
      pageMapsRef.current.set(page.id, result);
      setRegionsByPage((current) => ({ ...current, [page.id]: regions }));
      return result;
    })().finally(() => {
      if (!refresh) mapPromisesRef.current.delete(page.id);
    });
    if (!refresh) mapPromisesRef.current.set(page.id, mapping);
    return mapping;
  }, []);

  const authorPlan = useCallback(async (question: string) => {
    if (!activePage) throw new Error("Load slides before starting a session.");
    let pageMap = await ensurePageMap(activePage);
    let authored = await requestAuthoredPlan(question, pageMap, activePlanRef.current?.summary);
    if (!authored) {
      try {
        pageMap = await ensurePageMap(activePage, question, true);
        authored = await requestAuthoredPlan(question, pageMap, activePlanRef.current?.summary);
      } catch {
        // The cached page map can still provide a safe, grounded fallback.
      }
    }
    const plan = authored ?? createGroundedFallbackPlan(question, pageMap);
    if (!plan) throw new Error("Please point to the part you mean and ask again.");
    canvasRef.current?.clearTutorInk();
    if (!canvasRef.current?.beginTutorPerformance(plan)) throw new Error("The notebook is not ready yet.");
    activePlanRef.current = plan;
    return plan;
  }, [activePage, ensurePageMap]);

  const realtime = useRealtimePerformance({
    createPlan: authorPlan,
    onBeatCue: (planId, beatId, cueTimestamp) => {
      canvasRef.current?.renderTutorBeat(planId, beatId, cueTimestamp);
    },
    onInterrupted: ({ planId }) => canvasRef.current?.cancelTutorPerformance(planId),
    onTranscript: (event: RealtimeTranscriptEvent) => {
      if (event.direction === "learner" && event.final) setError("");
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

  const choosePage = useCallback((pageId: string) => {
    const page = pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    setActivePageId(pageId);
    canvasRef.current?.zoomToPage(pageId);
    void ensurePageMap(page).catch(() => undefined);
  }, [ensurePageMap, pages]);

  const setTool = useCallback((nextTool: NotebookCanvasTool) => {
    setToolState(nextTool);
    canvasRef.current?.setTool(nextTool);
  }, []);

  const startSession = useCallback(async () => {
    if (!activePage) return;
    setError("");
    const results = await Promise.allSettled([ensurePageMap(activePage), realtime.connect()]);
    const voice = results[1];
    if (voice.status === "rejected") setError(voice.reason instanceof Error ? voice.reason.message : "Voice is unavailable right now.");
  }, [activePage, ensurePageMap, realtime]);

  const pauseSession = useCallback(() => {
    realtime.interrupt();
    realtime.disconnect();
    canvasRef.current?.cancelTutorPerformance(activePlanRef.current?.id);
  }, [realtime]);

  const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePage?.id));
  const isSessionActive = realtime.state.connected;
  const sessionBusy = realtime.state.status === "connecting" || realtime.state.status === "thinking";

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
                  <Plus className="size-4" /> Load slides
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Link href="/deck/new" className="hidden rounded-md px-3 py-1.5 text-xs text-white/45 transition hover:bg-white/[0.06] hover:text-white/75 sm:block">Load slides</Link>
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
            onActivePageChange={choosePage}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-base font-medium text-white/80">Load slides to open a notebook</p>
              <Link href="/deck/new" className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-[#111]"><Plus className="size-4" /> Load slides</Link>
            </div>
          </div>
        )}

        {error ? (
          <div role="alert" className="absolute right-4 top-4 z-30 max-w-sm rounded-lg border border-red-300/15 bg-[#1b1515] px-3 py-2 text-xs text-red-200 shadow-[0_8px_8px_rgba(0,0,0,0.25)]">{error}</div>
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

async function requestAuthoredPlan(question: string, pageMap: PageMap, existingInkSummary?: string) {
  const response = await fetch("/api/notebook/probe/author", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: pageMap.imageDataUrl,
      question,
      regions: pageMap.regions,
      focusedRegionIds: pageMap.focusedRegionId ? [pageMap.focusedRegionId] : [],
      existingInkSummary: existingInkSummary ?? "The notebook is ready for a new explanation.",
    }),
  });
  const payload = await response.json().catch(() => ({})) as { planId?: unknown; plan?: unknown; code?: unknown };
  if (!response.ok || !isTutorInkPlan(payload.plan, payload.planId)) {
    console.warn("[studydeck] notebook response preparation will retry", {
      status: response.status,
      code: typeof payload.code === "string" ? payload.code : "INVALID_RESPONSE",
    });
    return null;
  }
  return payload.plan;
}

function createGroundedFallbackPlan(_question: string, pageMap: PageMap): TutorInkPlan | null {
  const region = pageMap.regions.find((candidate) => candidate.id === pageMap.focusedRegionId) ?? pageMap.regions[0];
  if (!region) return null;
  return {
    id: crypto.randomUUID(),
    summary: `Focus on ${region.label}`,
    narrationBrief: `Focus the learner on ${region.label} and ask them to narrow the question if they need a more detailed explanation.`,
    beats: [
      {
        id: "focus",
        atMs: 0,
        durationMs: 520,
        voiceCue: `Let's start with ${region.label}.`,
        action: { type: "circle", targetRegionId: region.id, color: "violet" },
      },
      {
        id: "identify",
        atMs: 560,
        durationMs: 420,
        voiceCue: "Could you point to the exact step or detail you want to unpack?",
        action: { type: "label", targetRegionId: region.id, text: region.label, placement: "south", color: "violet" },
      },
    ],
  };
}

async function compactImage(source: string) {
  const rawDataUrl = source.startsWith("data:") ? source : await urlToDataUrl(source);
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(rawDataUrl) && dataUrlByteLength(rawDataUrl) <= 980_000) return rawDataUrl;
  const image = await loadImage(rawDataUrl);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This page could not be prepared.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.58]) {
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
