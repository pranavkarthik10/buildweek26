"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { compressLegacySegments, createShapeId, Editor, Tldraw } from "@tldraw/tldraw";

import "@tldraw/tldraw/tldraw.css";

import { InkPlanScheduler, type InkPlan } from "@/lib/notebook-probe-sync";
import { CuePerformance } from "@/lib/notebook-probe-cue-performance";

import type { ProbeGesture, ProbeRegion, TutorInkBeat, TutorInkPlan } from "./probe-types";

type PageImage = { x: number; y: number; w: number; h: number };

export type TldrawProbeCanvasHandle = {
  /** Arms a plan for externally supplied audio / transport cues. It does not start a clock. */
  beginTutorPerformance: (plan: TutorInkPlan) => boolean;
  /** Appends one authored beat exactly once. Repeated, stale, and unknown cues are ignored safely. */
  renderTutorBeat: (planId: string, beatId: string, cueAtMs?: number) => boolean;
  /** Stops unfinished traces while keeping all completed tutor ink on the page. */
  cancelTutorPerformance: (planId?: string) => boolean;
  cancelTutorInk: () => void;
  clearTutorInk: () => void;
  /** Legacy local-clock fallback for environments where Realtime is unavailable. */
  playTutorInk: (plan: TutorInkPlan) => void;
};

export type TutorInkBeatTelemetry = {
  planId: string;
  beatId: string;
  kind: "first-paint" | "completed";
  /** Milliseconds measured from the transport cue supplied to renderTutorBeat. */
  cueToPaintMs: number;
};

type TldrawProbeCanvasProps = {
  imageUrl: string;
  imageKey: string;
  regions: ProbeRegion[];
  selectedRegionId?: string;
  onFocusGesture: (gesture: ProbeGesture) => void;
  /** Transport-neutral instrumentation; callers can correlate this with audio events. */
  onTutorInkTelemetry?: (event: TutorInkBeatTelemetry) => void;
};

const IMAGE_SHAPE_ID = createShapeId("notebook-probe-image");
const PAGE_ORIGIN = { x: 0, y: 0 };

export const TldrawProbeCanvas = forwardRef<TldrawProbeCanvasHandle, TldrawProbeCanvasProps>(function TldrawProbeCanvas(
  { imageUrl, imageKey, regions, selectedRegionId, onFocusGesture, onTutorInkTelemetry },
  ref,
) {
  const editorRef = useRef<Editor | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<PageImage>({ x: 0, y: 0, w: 1200, h: 900 });
  const gestureStartRef = useRef<{ pointerId: number; point: { x: number; y: number } } | null>(null);
  const regionsRef = useRef(regions);
  const planCancelRef = useRef<(() => void) | undefined>(undefined);
  const cuePerformanceRef = useRef(new CuePerformance<TutorInkBeat>());
  const activeAnimationsRef = useRef(new Map<string, ActiveInkAnimation>());
  const telemetryRef = useRef(onTutorInkTelemetry);
  const imageRenderTokenRef = useRef(0);

  useEffect(() => { regionsRef.current = regions; }, [regions]);
  useEffect(() => { telemetryRef.current = onTutorInkTelemetry; }, [onTutorInkTelemetry]);
  useEffect(() => () => {
    planCancelRef.current?.();
    for (const animation of activeAnimationsRef.current.values()) animation.cancel();
  }, []);

  const deleteByRole = useCallback((role: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const ids = editor.getCurrentPageShapes().filter((shape) => shape.meta?.notebookProbeRole === role).map((shape) => shape.id);
    if (ids.length) editor.deleteShapes(ids);
  }, []);

  const cancelActiveAnimations = useCallback((planId?: string) => {
    for (const [key, animation] of activeAnimationsRef.current) {
      if (planId && animation.planId !== planId) continue;
      animation.cancel();
      activeAnimationsRef.current.delete(key);
    }
  }, []);

  const cancelTutorPerformance = useCallback((planId?: string) => {
    const activePlanId = cuePerformanceRef.current.activePlanId;
    if (planId && activePlanId !== planId) return false;
    if (!activePlanId) return false;
    planCancelRef.current?.();
    planCancelRef.current = undefined;
    cuePerformanceRef.current.cancel(activePlanId);
    cancelActiveAnimations(activePlanId);
    return true;
  }, [cancelActiveAnimations]);

  const clearTutorInk = useCallback(() => {
    cancelTutorPerformance();
    cancelActiveAnimations();
    deleteByRole("tutor-ink");
  }, [cancelActiveAnimations, cancelTutorPerformance, deleteByRole]);

  const cancelTutorInk = useCallback(() => {
    cancelTutorPerformance();
  }, [cancelTutorPerformance]);

  const emitTelemetry = useCallback((event: TutorInkBeatTelemetry) => telemetryRef.current?.(event), []);

  const drawBeat = useCallback((planId: string, beat: TutorInkBeat, cueAtMs: number) => {
    const editor = editorRef.current;
    const action = beat.action;
    const region = "targetRegionId" in action ? regionsRef.current.find((candidate) => candidate.id === action.targetRegionId) : undefined;
    if (!editor || ("targetRegionId" in action && !region)) return false;
    const image = imageRef.current;
    const box = region?.box;
    if (!box && action.type !== "write") return false;
    const resolvedBox = box ?? { x: 0, y: 0, width: 0, height: 0 };
    const x = image.x + resolvedBox.x * image.w;
    const y = image.y + resolvedBox.y * image.h;
    const w = resolvedBox.width * image.w;
    const h = resolvedBox.height * image.h;
    const color = action.color;

    if (action.type === "circle") {
      const pad = Math.max(12, Math.min(w, h) * 0.12);
      const points = Array.from({ length: 37 }, (_, index) => {
        const angle = -Math.PI / 2 + (index / 36) * Math.PI * 2;
        return { x: x + w / 2 + Math.cos(angle) * (w / 2 + pad), y: y + h / 2 + Math.sin(angle) * (h / 2 + pad) };
      });
      startTracedBeat({ editor, planId, beat, cueAtMs, points, color, activeAnimations: activeAnimationsRef.current, emitTelemetry });
      return true;
    }

    if (action.type === "arrow") {
      const start = { x: x + w / 2, y: y + h / 2 };
      const end = labelPointForPlacement(image, resolvedBox, action.placement);
      startTracedBeat({ editor, planId, beat, cueAtMs, points: [start, end], color, activeAnimations: activeAnimationsRef.current, emitTelemetry });
      return true;
    }

    const labelPoint = action.type === "write"
      ? { x: image.x + action.x * image.w, y: image.y + action.y * image.h }
      : labelPointForPlacement(image, resolvedBox, action.placement);
    const text = action.type === "write" ? action.text : action.text;
    editor.createShape({
      id: createShapeId(`tutor-${beat.id}-${Date.now()}`),
      type: "text",
      x: labelPoint.x,
      y: labelPoint.y,
      isLocked: true,
      meta: { notebookProbeRole: "tutor-ink" },
      props: { richText: richText(text), color, size: "l", font: "draw", autoSize: true },
    } as Parameters<Editor["createShape"]>[0]);
    const elapsedMs = Math.max(0, performance.now() - cueAtMs);
    emitTelemetry({ planId, beatId: beat.id, kind: "first-paint", cueToPaintMs: elapsedMs });
    emitTelemetry({ planId, beatId: beat.id, kind: "completed", cueToPaintMs: elapsedMs });
    return true;
  }, [emitTelemetry]);

  const beginTutorPerformance = useCallback((plan: TutorInkPlan) => {
    if (!plan.id || new Set(plan.beats.map((beat) => beat.id)).size !== plan.beats.length || plan.beats.some((beat) => !beat.id)) return false;
    planCancelRef.current?.();
    planCancelRef.current = undefined;
    cancelActiveAnimations();
    return cuePerformanceRef.current.begin(plan);
  }, [cancelActiveAnimations]);

  const renderTutorBeat = useCallback((planId: string, beatId: string, cueAtMs = performance.now()) => {
    // Keep a cue retryable until the canvas has actually mounted.
    if (!editorRef.current) return false;
    const claim = cuePerformanceRef.current.claim(planId, beatId);
    if (claim.kind === "duplicate") return true;
    if (claim.kind !== "accepted") return false;
    return drawBeat(planId, claim.beat, cueAtMs);
  }, [drawBeat]);

  const playTutorInk = useCallback((plan: TutorInkPlan) => {
    clearTutorInk();
    const scheduledPlan: InkPlan<TutorInkBeat> = { id: plan.id, beats: plan.beats.map((beat) => ({ id: beat.id, atMs: beat.atMs, durationMs: beat.durationMs, voiceCue: beat.voiceCue, payload: beat })) };
    if (!beginTutorPerformance(plan)) return;
    const scheduler = new InkPlanScheduler<TutorInkBeat>({ onBeatStart: ({ beat }) => renderTutorBeat(plan.id, beat.id) });
    scheduler.start(scheduledPlan);
    planCancelRef.current = () => { scheduler.cancel(plan.id, "canvas-cleared"); };
  }, [beginTutorPerformance, clearTutorInk, renderTutorBeat]);

  useImperativeHandle(ref, () => ({
    beginTutorPerformance,
    renderTutorBeat,
    cancelTutorPerformance,
    cancelTutorInk,
    clearTutorInk,
    playTutorInk,
  }), [beginTutorPerformance, renderTutorBeat, cancelTutorPerformance, cancelTutorInk, clearTutorInk, playTutorInk]);

  const renderImage = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const renderToken = ++imageRenderTokenRef.current;
    clearTutorInk();
    deleteByRole("vision-region");
    const existing = editor.getShape(IMAGE_SHAPE_ID);
    if (existing) editor.deleteShapes([IMAGE_SHAPE_ID]);

    const dimensions = await imageDimensions(imageUrl);
    if (renderToken !== imageRenderTokenRef.current || !editorRef.current) return;
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / dimensions.w);
    const image = { x: PAGE_ORIGIN.x, y: PAGE_ORIGIN.y, w: Math.round(dimensions.w * scale), h: Math.round(dimensions.h * scale) };
    imageRef.current = image;
    const assetId = `asset:notebook-probe-${Date.now()}`;
    editor.createAssets([{
      id: assetId,
      typeName: "asset",
      type: "image",
      meta: { notebookProbeRole: "page-image" },
      props: { name: imageKey, src: imageUrl, w: dimensions.w, h: dimensions.h, mimeType: imageUrl.startsWith("data:image/png") ? "image/png" : null, isAnimated: false },
    }] as unknown as Parameters<Editor["createAssets"]>[0]);
    editor.createShape({
      id: IMAGE_SHAPE_ID,
      type: "image",
      x: image.x,
      y: image.y,
      isLocked: true,
      meta: { notebookProbeRole: "page-image" },
      props: { w: image.w, h: image.h, assetId, url: imageUrl, crop: null, flipX: false, flipY: false, playing: false, altText: `Loaded diagram: ${imageKey}` },
    } as unknown as Parameters<Editor["createShape"]>[0]);
    const bounds = editor.getShapePageBounds(IMAGE_SHAPE_ID);
    if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 220 }, inset: 72 });
  }, [clearTutorInk, deleteByRole, imageKey, imageUrl]);

  const renderRegions = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    deleteByRole("vision-region");
    const image = imageRef.current;
    const shapes = regions.filter((region) => region.id === selectedRegionId).flatMap((region) => {
      const color = "green" as const;
      const width = Math.max(12, region.box.width * image.w);
      const height = Math.max(12, region.box.height * image.h);
      const x = image.x + region.box.x * image.w;
      const y = image.y + region.box.y * image.h;
      return [{
        id: createShapeId(`vision-${region.id}`),
        type: "geo" as const,
        x,
        y,
        isLocked: true,
        meta: { notebookProbeRole: "vision-region", regionId: region.id },
        props: { geo: "rectangle" as const, w: width, h: height, color, fill: "none" as const, dash: "dashed" as const, size: region.id === selectedRegionId ? "l" as const : "m" as const },
      }, {
        id: createShapeId(`vision-anchor-${region.id}`),
        type: "geo" as const,
        x: x + width / 2 - 6,
        y: y + height / 2 - 6,
        isLocked: true,
        meta: { notebookProbeRole: "vision-region", regionId: region.id },
        props: { geo: "ellipse" as const, w: 12, h: 12, color, fill: "semi" as const, dash: "solid" as const, size: "s" as const },
      }];
    });
    if (shapes.length) editor.createShapes(shapes as Parameters<Editor["createShapes"]>[0]);
  }, [deleteByRole, regions, selectedRegionId]);

  useEffect(() => { void renderImage(); }, [renderImage]);
  useEffect(() => { renderRegions(); }, [renderRegions]);

  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    editor.setCurrentTool("hand");
    void renderImage();
  }, [renderImage]);

  const toNormalized = useCallback((clientX: number, clientY: number) => {
    const editor = editorRef.current;
    if (!editor) return null;
    const page = editor.screenToPage({ x: clientX, y: clientY });
    const image = imageRef.current;
    if (page.x < image.x || page.y < image.y || page.x > image.x + image.w || page.y > image.y + image.h) return null;
    return { x: clamp((page.x - image.x) / image.w), y: clamp((page.y - image.y) / image.h) };
  }, []);

  const pointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Touch stays entirely with tldraw's hand tool, retaining its native pan/pinch behaviour.
    if (event.pointerType === "touch") return;
    const point = toNormalized(event.clientX, event.clientY);
    if (point) gestureStartRef.current = { pointerId: event.pointerId, point };
  }, [toNormalized]);

  const pointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = gestureStartRef.current;
    if (!start || start.pointerId !== event.pointerId || event.pointerType === "touch") return;
    gestureStartRef.current = null;
    const end = toNormalized(event.clientX, event.clientY);
    if (!end) return;
    const minX = Math.min(start.point.x, end.x), minY = Math.min(start.point.y, end.y);
    onFocusGesture({
      points: [start.point, end],
      bounds: { x: minX, y: minY, w: Math.abs(end.x - start.point.x), h: Math.abs(end.y - start.point.y) },
    });
  }, [onFocusGesture, toNormalized]);

  return <div ref={canvasRef} className="absolute inset-0 touch-none" onPointerDownCapture={pointerDown} onPointerUpCapture={pointerUp}>
    <Tldraw hideUi onMount={onMount} licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY} />
    <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-white/10 bg-[#111711]/88 px-3 py-2 text-xs text-[#d6e2d1] shadow-lg backdrop-blur"><span className="font-semibold text-[#c6ff67]">Pencil / mouse</span> focus · <span className="font-semibold text-[#c6ff67]">touch</span> pan + pinch</div>
  </div>;
});

function richText(text: string) {
  return { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] };
}

function labelPointForPlacement(image: PageImage, box: ProbeRegion["box"], placement: "north" | "east" | "south" | "west") {
  const x = image.x + box.x * image.w;
  const y = image.y + box.y * image.h;
  const w = box.width * image.w;
  const h = box.height * image.h;
  const gap = 44;
  if (placement === "north") return { x: x + w / 2, y: Math.max(image.y + 12, y - gap) };
  if (placement === "south") return { x: x + w / 2, y: Math.min(image.y + image.h - 22, y + h + gap) };
  if (placement === "west") return { x: Math.max(image.x + 12, x - gap), y: y + h / 2 };
  return { x: Math.min(image.x + image.w - 160, x + w + gap), y: y + h / 2 };
}

type InkColor = "violet" | "red" | "blue" | "green" | "orange";

type ActiveInkAnimation = {
  planId: string;
  cancel: () => void;
};

type StartTracedBeatOptions = {
  editor: Editor;
  planId: string;
  beat: TutorInkBeat;
  cueAtMs: number;
  points: Array<{ x: number; y: number }>;
  color: InkColor;
  activeAnimations: Map<string, ActiveInkAnimation>;
  emitTelemetry: (event: TutorInkBeatTelemetry) => void;
};

function startTracedBeat({ editor, planId, beat, cueAtMs, points, color, activeAnimations, emitTelemetry }: StartTracedBeatOptions) {
  const key = `${planId}:${beat.id}`;
  const cancel = traceStroke(editor, points, color, beat.durationMs, {
    planId,
    beatId: beat.id,
    cueAtMs,
    onFirstPaint: (cueToPaintMs) => emitTelemetry({ planId, beatId: beat.id, kind: "first-paint", cueToPaintMs }),
    onComplete: (cueToPaintMs) => {
      activeAnimations.delete(key);
      emitTelemetry({ planId, beatId: beat.id, kind: "completed", cueToPaintMs });
    },
  });
  activeAnimations.set(key, { planId, cancel });
}

/**
 * Animate a tldraw draw shape by replacing its freehand segment every frame.
 * Cancelling removes only this unfinished trace: previous, completed tutor ink
 * remains in the document for an interruption or plan replacement.
 */
function traceStroke(
  editor: Editor,
  pagePoints: Array<{ x: number; y: number }>,
  color: InkColor,
  durationMs: number,
  lifecycle: {
    planId: string;
    beatId: string;
    cueAtMs: number;
    onFirstPaint: (cueToPaintMs: number) => void;
    onComplete: (cueToPaintMs: number) => void;
  },
) {
  if (pagePoints.length < 2) return () => {};
  const id = createShapeId(`trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const origin = pagePoints[0];
  const toSegment = (count: number) => compressLegacySegments([{
    type: "free" as const,
    points: pagePoints.slice(0, Math.max(2, count)).map((point) => ({ x: point.x - origin.x, y: point.y - origin.y, z: 0.5 })),
  }]);
  editor.createShape({
    id,
    type: "draw",
    x: origin.x,
    y: origin.y,
    isLocked: false,
    meta: { notebookProbeRole: "tutor-ink", planId: lifecycle.planId, beatId: lifecycle.beatId },
    props: { segments: toSegment(2), color, size: "l", isComplete: false },
  } as unknown as Parameters<Editor["createShape"]>[0]);
  const startedAt = performance.now();
  let frameId: number | undefined;
  let cancelled = false;
  let firstPainted = false;
  let completed = false;
  const frame = (now: number) => {
    if (cancelled) return;
    if (!firstPainted) {
      firstPainted = true;
      lifecycle.onFirstPaint(Math.max(0, now - lifecycle.cueAtMs));
    }
    const progress = Math.min(1, (now - startedAt) / Math.max(120, durationMs));
    const count = Math.max(2, Math.ceil(progress * pagePoints.length));
    editor.updateShape({ id, type: "draw", isLocked: progress >= 1, props: { segments: toSegment(count), isComplete: progress >= 1 } } as unknown as Parameters<Editor["updateShape"]>[0]);
    if (progress < 1) {
      frameId = window.requestAnimationFrame(frame);
    } else {
      completed = true;
      lifecycle.onComplete(Math.max(0, now - lifecycle.cueAtMs));
    }
  };
  frameId = window.requestAnimationFrame(frame);

  return () => {
    if (cancelled || completed) return;
    cancelled = true;
    if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    if (editor.getShape(id)) editor.deleteShapes([id]);
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

async function imageDimensions(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.naturalWidth || 1200, h: image.naturalHeight || 900 });
    image.onerror = () => resolve({ w: 1200, h: 900 });
    image.src = src;
  });
}
