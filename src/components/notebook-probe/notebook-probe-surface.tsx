"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Aperture, LoaderCircle, Play, RefreshCw, Upload } from "lucide-react";

import type { ProbeGesture, ProbeRegion, TutorInkPlan } from "./probe-types";
import { RealtimePerformanceControls, type RealtimePerformanceState as ControlsState } from "./realtime-performance-controls";
import type { TldrawProbeCanvasHandle, TutorInkBeatTelemetry } from "./tldraw-probe-canvas";
import { useRealtimePerformance, type RealtimeTranscriptEvent } from "./use-realtime-performance";

const NotebookProbeCanvas = dynamic(
  () => import("./tldraw-probe-canvas").then((module) => module.TldrawProbeCanvas),
  {
    ssr: false,
    loading: () => <div className="flex h-full items-center justify-center bg-[#101411] text-sm text-[#d8e2d4]">Loading canvas…</div>,
  },
);

const BUILT_IN_FIXTURE = "/notebook-probe/cell-unlabeled.jpg";

type CanvasHandle = TldrawProbeCanvasHandle;

function initialTutorPlan(regions: ProbeRegion[]): TutorInkPlan {
  const region = regions[0];
  if (!region) return { id: "empty-plan", summary: "No regions", narrationBrief: "", beats: [] };
  return {
    id: `local-plan-${Date.now()}`,
    summary: "Local fallback tutor ink",
    narrationBrief: `Focus on the ${region.label}.`,
    beats: [
      { id: "circle", atMs: 0, durationMs: 360, voiceCue: `Find the ${region.label}.`, action: { type: "circle", targetRegionId: region.id, color: "orange" } },
      { id: "arrow", atMs: 450, durationMs: 340, voiceCue: "Follow this connection.", action: { type: "arrow", targetRegionId: region.id, placement: "east", color: "orange" } },
      { id: "label", atMs: 940, durationMs: 480, voiceCue: `This is the ${region.label}.`, action: { type: "label", targetRegionId: region.id, text: region.label, placement: "east", color: "orange" } },
    ],
  };
}

export function NotebookProbeSurface() {
  const canvasRef = useRef<CanvasHandle | null>(null);
  const activePlanRef = useRef<TutorInkPlan | null>(null);
  const autoProbedImageRef = useRef<string | null>(null);
  const [imageUrl, setImageUrl] = useState(BUILT_IN_FIXTURE);
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>();
  const [fileName, setFileName] = useState("cell-unlabeled.jpg");
  const [probeImageDataUrl, setProbeImageDataUrl] = useState<string | undefined>();
  const [regions, setRegions] = useState<ProbeRegion[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string | undefined>();
  const [question, setQuestion] = useState("What does this part do?");
  const [requestState, setRequestState] = useState<"idle" | "probing" | "error">("idle");
  const [lastGesture, setLastGesture] = useState<ProbeGesture | undefined>();
  const [notice, setNotice] = useState("Preparing the diagram so you can ask about it aloud.");
  const [transcript, setTranscript] = useState("");
  const [currentBeat, setCurrentBeat] = useState(0);
  const [totalBeats, setTotalBeats] = useState(0);

  const authorPlan = useCallback(async (spokenQuestion: string) => {
    if (!regions.length) throw new Error("The diagram is still being mapped. Try again when its regions appear.");
    setQuestion(spokenQuestion);
    setNotice("Thinking about the clearest way to show that…");
    const exactImageDataUrl = probeImageDataUrl ?? await compactImageForProbe(imageDataUrl ?? imageUrl);
    const response = await fetch("/api/notebook/probe/author", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: exactImageDataUrl,
        question: spokenQuestion,
        regions,
        focusedRegionIds: selectedRegion ? [selectedRegion] : [],
        existingInkSummary: activePlanRef.current?.summary ?? "The tutor layer is clear.",
      }),
    });
    const payload = await response.json().catch(() => ({})) as { planId?: unknown; plan?: unknown };
    if (!response.ok) throw new Error("I couldn’t prepare that explanation");
    const plan = isTutorInkPlan(payload.plan, payload.planId) ? payload.plan : null;
    if (!plan) throw new Error("I couldn’t prepare that explanation");
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("The notebook canvas is not ready yet");
    canvas.clearTutorInk();
    if (!canvas.beginTutorPerformance(plan)) throw new Error("I couldn’t prepare that explanation");
    activePlanRef.current = plan;
    setCurrentBeat(0);
    setTotalBeats(plan.beats.length);
    setNotice("I’ve got it. Watch the page as I explain.");
    return plan;
  }, [imageDataUrl, imageUrl, probeImageDataUrl, regions, selectedRegion]);

  const onBeatCue = useCallback((planId: string, beatId: string, cueTimestamp: number) => {
    const plan = activePlanRef.current;
    if (!plan || plan.id !== planId) return;
    const beatIndex = plan.beats.findIndex((beat) => beat.id === beatId);
    if (beatIndex < 0) return;
    canvasRef.current?.renderTutorBeat(planId, beatId, cueTimestamp);
    setCurrentBeat(beatIndex + 1);
    setNotice(plan.beats[beatIndex].voiceCue);
  }, []);

  const onTranscript = useCallback((event: RealtimeTranscriptEvent) => {
    if (!event.final || !event.text.trim()) return;
    setTranscript(`${event.direction === "learner" ? "You" : "Tutor"}: ${event.text.trim()}`);
    if (event.direction === "learner") setQuestion(event.text.trim());
  }, []);

  const realtime = useRealtimePerformance({
    createPlan: authorPlan,
    onBeatCue,
    onInterrupted: ({ planId }) => {
      canvasRef.current?.cancelTutorPerformance(planId);
      setNotice("Interrupted—the voice and unfinished mark stopped together. Ask a follow-up whenever you’re ready.");
    },
    onTranscript,
  });

  const probe = useCallback(async (gesture?: ProbeGesture) => {
    setRequestState("probing");
    setLastGesture(gesture);
    setNotice(gesture ? "Looking closely at that part…" : "Getting the diagram ready…");
    try {
      const exactImageDataUrl = await compactImageForProbe(imageDataUrl ?? imageUrl);
      setProbeImageDataUrl(exactImageDataUrl);
      const response = await fetch("/api/notebook/probe/vision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageDataUrl: exactImageDataUrl, question, gesture: toVisionGesture(gesture) }),
      });
      if (!response.ok) throw new Error("I couldn’t read this diagram");
      const payload = await response.json() as { regions?: unknown; focusedRegionId?: unknown };
      const nextRegions = Array.isArray(payload.regions) ? payload.regions.filter(isProbeRegion) : [];
      const focusedRegionId = typeof payload.focusedRegionId === "string" ? payload.focusedRegionId : null;
      setRegions(nextRegions);
      setSelectedRegion(focusedRegionId ?? nextRegions[0]?.id);
      setRequestState("idle");
      setNotice(nextRegions.length ? "Ready. Connect voice and ask naturally, or point to a part first." : "I couldn’t find a clear part there. Try pointing more precisely.");
    } catch (error) {
      setRequestState("error");
      setNotice(error instanceof Error ? `${error.message}. You can still move around the page.` : "I couldn’t read this diagram. You can still move around the page.");
    }
  }, [imageDataUrl, imageUrl, question]);

  useEffect(() => {
    if (autoProbedImageRef.current === imageUrl) return;
    autoProbedImageRef.current = imageUrl;
    void probe();
  }, [imageUrl, probe]);

  const onFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setImageUrl(reader.result);
      setImageDataUrl(reader.result);
      setFileName(file.name);
      setProbeImageDataUrl(undefined);
      setRegions([]);
      setSelectedRegion(undefined);
      activePlanRef.current = null;
      setCurrentBeat(0);
      setTotalBeats(0);
      canvasRef.current?.clearTutorInk();
      setNotice("New diagram loaded. Getting it ready for your questions…");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }, []);

  const play = useCallback(async () => {
    if (!regions.length) {
      setNotice("Give me a moment to finish reading the diagram first.");
      return;
    }
    setNotice("Thinking about the clearest way to show that…");
    try {
      const plan = await authorPlan(question);
      try {
        await realtime.startPlan(plan);
      } catch (voiceError) {
        canvasRef.current?.playTutorInk(plan);
        setNotice(`${voiceError instanceof Error ? voiceError.message : "Voice couldn’t connect"}. Showing the explanation without voice.`);
      }
    } catch (error) {
      const plan = initialTutorPlan(regions);
      activePlanRef.current = plan;
      setTotalBeats(plan.beats.length);
      setCurrentBeat(plan.beats.length);
      canvasRef.current?.playTutorInk(plan);
      setNotice(error instanceof Error ? `${error.message}. Showing a simple explanation instead.` : "Showing a simple explanation instead.");
    }
  }, [authorPlan, question, realtime, regions]);

  const connectVoice = useCallback(async () => {
    try {
      await realtime.connect();
      setNotice("Voice is live. Ask about the diagram, interrupt naturally, or point somewhere first.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Voice couldn’t connect.");
    }
  }, [realtime]);

  const interrupt = useCallback(() => {
    realtime.interrupt();
    canvasRef.current?.cancelTutorPerformance(activePlanRef.current?.id);
    setNotice("Stopped. Completed ink stays on the page; ask a follow-up to continue.");
  }, [realtime]);

  const onTutorInkTelemetry = useCallback((event: TutorInkBeatTelemetry) => {
    if (process.env.NODE_ENV === "development" && event.kind === "first-paint" && activePlanRef.current?.id === event.planId) {
      console.debug("[studydeck] drawing cue latency", { beatId: event.beatId, cueToPaintMs: Math.round(event.cueToPaintMs) });
    }
  }, []);

  const controlsState: ControlsState = realtime.state.status === "ready"
    ? "listening"
    : realtime.state.status;

  return <main className="flex h-dvh min-h-[620px] flex-col overflow-hidden bg-[#101411] text-[#eff4ed]">
    <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#151b16] px-4 py-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#c6ff67] text-[#182012]"><Aperture className="size-5" strokeWidth={2.2} /></div>
        <div className="min-w-0"><p className="text-xs font-semibold tracking-[0.16em] text-[#c6ff67]">studydeck · live notebook</p><h1 className="truncate text-base font-semibold tracking-tight text-white">Ask → watch → interrupt</h1></div>
      </div>
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-sm font-medium text-[#e7eee4] transition hover:bg-white/10">
        <Upload className="size-4" />
        <span className="hidden sm:inline">Load image</span>
        <input className="sr-only" type="file" accept="image/*" onChange={onFile} />
      </label>
    </header>

    <section className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative min-h-0 border-b border-white/10 lg:border-r lg:border-b-0">
        <NotebookProbeCanvas
          ref={canvasRef}
          imageUrl={imageUrl}
          imageKey={fileName}
          regions={regions}
          selectedRegionId={selectedRegion}
          onFocusGesture={probe}
          onTutorInkTelemetry={onTutorInkTelemetry}
        />
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3 sm:left-6 sm:right-6">
          <p className="max-w-xl rounded-lg border border-white/10 bg-[#111711]/88 px-3 py-2 text-xs leading-5 text-[#cbd7c6] shadow-xl backdrop-blur">{notice}</p>
          {requestState === "probing" ? <div className="flex items-center gap-2 rounded-lg bg-[#c6ff67] px-3 py-2 text-xs font-semibold text-[#182012]"><LoaderCircle className="size-4 animate-spin" /> reading</div> : null}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col bg-[#151b16] p-4 sm:p-5">
        <div className="mb-5"><p className="text-xs font-semibold tracking-[0.14em] text-[#a8b6a3]">PAGE</p><p className="mt-1 truncate text-sm text-white">{fileName}</p></div>
        <RealtimePerformanceControls
          state={controlsState}
          microphoneMuted={realtime.state.muted}
          currentBeat={currentBeat}
          totalBeats={totalBeats}
          transcript={transcript}
          errorMessage={realtime.state.error}
          onConnect={() => void connectVoice()}
          onPlay={() => void play()}
          onInterrupt={interrupt}
          onToggleMute={realtime.state.muted ? realtime.unmute : realtime.mute}
        />
        <label className="mt-5 mb-4 block text-xs font-semibold tracking-[0.1em] text-[#a8b6a3]">ASK OR SAY
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="mt-2 min-h-20 w-full resize-none rounded-lg border border-white/12 bg-[#0d110e] px-3 py-2 text-sm font-normal tracking-normal text-white outline-none transition focus:border-[#c6ff67]" />
        </label>
        <div className="mb-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => probe(lastGesture)} disabled={requestState === "probing"} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#c6ff67] px-3 py-2.5 text-sm font-semibold text-[#182012] transition hover:bg-[#dbff9c] disabled:cursor-wait disabled:opacity-70"><RefreshCw className="size-4" /> Rescan</button>
          <button type="button" onClick={() => void play()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#c6ff67]/40 bg-[#c6ff67]/8 px-3 py-2.5 text-sm font-semibold text-[#dfffb2] transition hover:bg-[#c6ff67]/15"><Play className="size-4 fill-current" /> Ask typed</button>
        </div>

        <div className="min-h-0 flex-1"><p className="mb-2 text-xs font-semibold tracking-[0.14em] text-[#a8b6a3]">ON THIS PAGE</p>{regions.length ? <div className="space-y-2">{regions.map((region) => <button key={region.id} type="button" onClick={() => setSelectedRegion(region.id)} className={`w-full rounded-lg border px-3 py-2 text-left transition ${selectedRegion === region.id ? "border-[#c6ff67]/70 bg-[#c6ff67]/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}><span className="block text-sm font-medium text-white">{region.label}</span></button>)}</div> : <p className="text-sm leading-6 text-[#9eaa99]">The parts I can discuss will appear here when the page is ready.</p>}</div>
      </aside>
    </section>
  </main>;
}

function isProbeRegion(value: unknown): value is ProbeRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Partial<ProbeRegion>;
  if (!region.box || typeof region.box !== "object") return false;
  const box = region.box as ProbeRegion["box"];
  return typeof region.id === "string" && typeof region.label === "string" && typeof region.confidence === "number" && typeof region.kind === "string" && typeof box.x === "number" && typeof box.y === "number" && typeof box.width === "number" && typeof box.height === "number";
}

function toVisionGesture(gesture?: ProbeGesture) {
  if (!gesture) return undefined;
  const point = gesture.points[0];
  const end = gesture.points.at(-1);
  if (!point || !end) return undefined;
  const distance = Math.hypot(end.x - point.x, end.y - point.y);
  return distance < 0.012 ? { kind: "tap" as const, point } : { kind: "drag" as const, point, end };
}

function isTutorInkPlan(value: unknown, planId: unknown): value is TutorInkPlan {
  if (!value || typeof value !== "object" || typeof planId !== "string") return false;
  const plan = value as Partial<TutorInkPlan>;
  const valid = typeof plan.summary === "string" && typeof plan.narrationBrief === "string" && Array.isArray(plan.beats) && plan.beats.every((beat) => {
    if (!beat || typeof beat.action !== "object" || !beat.action) return false;
    const action = beat.action as { type?: unknown };
    return typeof beat.id === "string" && typeof beat.atMs === "number" && typeof beat.durationMs === "number" && typeof beat.voiceCue === "string" && ["circle", "arrow", "label", "write"].includes(typeof action.type === "string" ? action.type : "");
  });
  if (valid) Object.assign(plan, { id: planId });
  return valid;
}

async function compactImageForProbe(source: string) {
  const rawDataUrl = source.startsWith("data:") ? source : await urlToDataUrl(source);
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(rawDataUrl) && dataUrlByteLength(rawDataUrl) <= 980_000) return rawDataUrl;
  const image = await loadImage(rawDataUrl);
  const canvas = document.createElement("canvas");
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("I couldn’t prepare this image");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.58]) {
    const compact = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(compact) <= 980_000) return compact;
  }
  throw new Error("This image is too detailed to read quickly");
}

async function urlToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the diagram image");
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the diagram image")); reader.onerror = () => reject(new Error("Could not read the diagram image")); reader.readAsDataURL(blob); });
}

function dataUrlByteLength(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return base64.length / 4 * 3 - padding;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Could not process the diagram image")); image.src = src; });
}
