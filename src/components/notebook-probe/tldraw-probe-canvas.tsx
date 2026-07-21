"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import {
  compressLegacySegments,
  createShapeId,
  DefaultColorStyle,
  DefaultSizeStyle,
  Editor,
  Tldraw,
  type TLAssetId,
} from "@tldraw/tldraw";

import "@tldraw/tldraw/tldraw.css";

import { InkPlanScheduler, type InkPlan } from "@/lib/notebook-probe-sync";
import { CuePerformance } from "@/lib/notebook-probe-cue-performance";

import type { ProbeGesture, ProbeRegion, TutorInkBeat, TutorInkPlan } from "./probe-types";

type PageImage = { x: number; y: number; w: number; h: number };
export type NotebookCanvasPage = { id: string; title: string; imageUrl: string; pageNumber: number };
export type NotebookCanvasTool = "select" | "draw" | "highlight" | "eraser" | "hand";
export type NotebookPenStyle = {
  color: "black" | "blue" | "red" | "green" | "violet" | "yellow";
  size: "s" | "m" | "l" | "xl";
};

export type ActivePageComposite = {
  imageDataUrl: string;
  hasLearnerInk: boolean;
  learnerStrokeCount: number;
  pageId: string;
};

export type TldrawProbeCanvasHandle = {
  /** Arms a plan for externally supplied audio / transport cues. It does not start a clock. */
  beginTutorPerformance: (plan: TutorInkPlan) => boolean;
  /** Appends one authored beat exactly once. Repeated, stale, and unknown cues are ignored safely. */
  renderTutorBeat: (planId: string, beatId: string, cueAtMs?: number) => boolean;
  /** Stops unfinished traces while keeping all completed tutor ink on the page. */
  cancelTutorPerformance: (planId?: string, options?: { preserveClaims?: boolean }) => boolean;
  cancelTutorInk: () => void;
  clearTutorInk: () => void;
  /** Legacy local-clock fallback for environments where Realtime is unavailable. */
  playTutorInk: (plan: TutorInkPlan) => void;
  setTool: (tool: NotebookCanvasTool) => void;
  setPenStyle: (style: NotebookPenStyle) => void;
  zoomToPage: (pageId: string) => void;
  /** Page currently centered in the viewport (updated while panning). */
  getActivePageId: () => string | undefined;
  /** Page image plus learner ink (excludes tutor marks and vision overlays). */
  exportActivePageComposite: (options?: { includeTutorInk?: boolean }) => Promise<ActivePageComposite | null>;
  hasLearnerInk: () => boolean;
};

export type TutorInkBeatTelemetry = {
  planId: string;
  beatId: string;
  kind: "first-paint" | "completed";
  /** Milliseconds measured from the transport cue supplied to renderTutorBeat. */
  cueToPaintMs: number;
};

type TldrawProbeCanvasProps = {
  imageUrl?: string;
  imageKey?: string;
  pages?: NotebookCanvasPage[];
  activePageId?: string;
  regions: ProbeRegion[];
  selectedRegionId?: string;
  onFocusGesture?: (gesture: ProbeGesture) => void;
  onActivePageChange?: (pageId: string) => void;
  persistenceKey?: string;
  /** Transport-neutral instrumentation; callers can correlate this with audio events. */
  onTutorInkTelemetry?: (event: TutorInkBeatTelemetry) => void;
};

const PAGE_ORIGIN = { x: 0, y: 0 };
const PAGE_GAP = 420;
const LEARNER_INK_PADDING = 48;

export const TldrawProbeCanvas = forwardRef<TldrawProbeCanvasHandle, TldrawProbeCanvasProps>(function TldrawProbeCanvas(
  { imageUrl, imageKey, pages, activePageId, regions, selectedRegionId, onFocusGesture, onActivePageChange, persistenceKey, onTutorInkTelemetry },
  ref,
) {
  const editorRef = useRef<Editor | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<PageImage>({ x: 0, y: 0, w: 1200, h: 900 });
  const pageImagesRef = useRef(new Map<string, PageImage>());
  const activePageIdRef = useRef(activePageId ?? pages?.[0]?.id ?? "legacy-page");
  const gestureStartRef = useRef<{ pointerId: number; point: { x: number; y: number } } | null>(null);
  const regionsRef = useRef(regions);
  const planCancelRef = useRef<(() => void) | undefined>(undefined);
  const cuePerformanceRef = useRef(new CuePerformance<TutorInkBeat>());
  const activeAnimationsRef = useRef(new Map<string, ActiveInkAnimation>());
  const telemetryRef = useRef(onTutorInkTelemetry);
  const imageRenderTokenRef = useRef(0);
  const onActivePageChangeRef = useRef(onActivePageChange);
  const hasFittedCameraRef = useRef(false);
  const penStyleRef = useRef<NotebookPenStyle>({ color: "blue", size: "m" });

  useEffect(() => { regionsRef.current = regions; }, [regions]);
  useEffect(() => { onActivePageChangeRef.current = onActivePageChange; }, [onActivePageChange]);
  useEffect(() => {
    activePageIdRef.current = activePageId ?? pages?.[0]?.id ?? "legacy-page";
    imageRef.current = pageImagesRef.current.get(activePageIdRef.current) ?? imageRef.current;
  }, [activePageId, pages]);
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
      const beatId = key.split(":")[1];
      if (planId && beatId) cuePerformanceRef.current.release(planId, beatId);
    }
  }, []);

  const cancelTutorPerformance = useCallback((planId?: string, options?: { preserveClaims?: boolean }) => {
    const activePlanId = cuePerformanceRef.current.activePlanId;
    if (planId && activePlanId !== planId) return false;
    if (!activePlanId) return false;
    planCancelRef.current?.();
    planCancelRef.current = undefined;
    cancelActiveAnimations(activePlanId);
    if (!options?.preserveClaims) cuePerformanceRef.current.cancel(activePlanId);
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

  const collectActivePageShapes = useCallback((includeTutorInk: boolean) => {
    const editor = editorRef.current;
    const page = imageRef.current;
    const pageId = activePageIdRef.current;
    if (!editor) return { shapes: [], learnerStrokeCount: 0 };
    const bounds = {
      x: page.x - LEARNER_INK_PADDING,
      y: page.y - LEARNER_INK_PADDING,
      w: page.w + LEARNER_INK_PADDING * 2,
      h: page.h + LEARNER_INK_PADDING * 2 + page.h * 0.35,
    };
    let learnerStrokeCount = 0;
    const shapes = editor.getCurrentPageShapes().filter((shape) => {
      const role = shape.meta?.notebookProbeRole;
      if (role === "vision-region") return false;
      if (role === "tutor-ink") return includeTutorInk;
      if (role === "page-image") return shape.meta?.notebookPageId === pageId;
      if (!shapeIntersectsBounds(shape, bounds)) return false;
      if (shape.type === "draw" || shape.type === "text" || shape.type === "geo" || shape.type === "arrow" || shape.type === "highlight" || shape.type === "line") {
        learnerStrokeCount += 1;
        return true;
      }
      return false;
    });
    return { shapes, learnerStrokeCount };
  }, []);

  const hasLearnerInk = useCallback(() => collectActivePageShapes(false).learnerStrokeCount > 0, [collectActivePageShapes]);

  const applyLearnerPenStyle = useCallback((editor: Editor, style = penStyleRef.current) => {
    // White PDF pages need a real dark/blue stroke. Dark-scheme "black" reads as gray.
    editor.user.updateUserPreferences({ colorScheme: "light" });
    editor.setStyleForNextShapes(DefaultColorStyle, style.color);
    editor.setStyleForNextShapes(DefaultSizeStyle, style.size);
  }, []);

  const exportActivePageComposite = useCallback(async (options?: { includeTutorInk?: boolean }): Promise<ActivePageComposite | null> => {
    const editor = editorRef.current;
    const page = imageRef.current;
    const pageId = activePageIdRef.current;
    if (!editor) return null;
    const { shapes, learnerStrokeCount } = collectActivePageShapes(Boolean(options?.includeTutorInk));
    if (!shapes.length) return null;
    try {
      const exported = await editor.toImageDataUrl(shapes, {
        format: "jpeg",
        quality: 0.82,
        scale: Math.min(1, 1280 / Math.max(page.w, page.h)),
        background: true,
        padding: 12,
      } as Parameters<Editor["toImageDataUrl"]>[1]);
      const imageDataUrl = typeof exported === "string" ? exported : exported?.url;
      if (!imageDataUrl || typeof imageDataUrl !== "string") return null;
      if (imageDataUrl.length > 6_400_000) return null;
      return { imageDataUrl, hasLearnerInk: learnerStrokeCount > 0, learnerStrokeCount, pageId };
    } catch {
      return null;
    }
  }, [collectActivePageShapes]);

  const drawBeat = useCallback((planId: string, beat: TutorInkBeat, cueAtMs: number) => {
    const editor = editorRef.current;
    const action = beat.action;
    const region = "targetRegionId" in action ? regionsRef.current.find((candidate) => candidate.id === action.targetRegionId) : undefined;
    if (!editor || ("targetRegionId" in action && !region)) return false;
    const image = imageRef.current;
    const box = region?.box;
    if (!box && action.type !== "write" && action.type !== "underline" && action.type !== "speak") return false;
    if (action.type === "speak") {
      emitTelemetry({ planId, beatId: beat.id, kind: "first-paint", cueToPaintMs: Math.max(0, performance.now() - cueAtMs) });
      emitTelemetry({ planId, beatId: beat.id, kind: "completed", cueToPaintMs: Math.max(0, performance.now() - cueAtMs) });
      return true;
    }
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
      startTracedBeat({ editor, planId, beat, cueAtMs, strokes: [points], color, activeAnimations: activeAnimationsRef.current, emitTelemetry });
      return true;
    }

    if (action.type === "arrow") {
      const start = { x: x + w / 2, y: y + h / 2 };
      const end = labelPointForPlacement(image, resolvedBox, action.placement);
      startTracedBeat({ editor, planId, beat, cueAtMs, strokes: [[start, end]], color, activeAnimations: activeAnimationsRef.current, emitTelemetry });
      return true;
    }

    if (action.type === "underline") {
      const start = { x: image.x + action.x * image.w, y: image.y + action.y * image.h };
      const end = { x: start.x + action.width * image.w, y: start.y + Math.min(10, image.h * 0.01) };
      const mid = { x: (start.x + end.x) / 2, y: start.y + 4 };
      startTracedBeat({
        editor,
        planId,
        beat,
        cueAtMs,
        strokes: [[start, mid, end]],
        color,
        activeAnimations: activeAnimationsRef.current,
        emitTelemetry,
        size: "l",
      });
      return true;
    }

    const labelPoint = action.type === "write"
      ? { x: image.x + action.x * image.w, y: image.y + action.y * image.h }
      : labelPointForPlacement(image, resolvedBox, action.placement);
    const text = action.text;
    const durationMs = Math.max(beat.durationMs, Math.min(2_800, 220 + text.length * 55));
    startHandwrittenTextBeat({
      editor,
      planId,
      beat: { ...beat, durationMs },
      cueAtMs,
      origin: labelPoint,
      text,
      color,
      activeAnimations: activeAnimationsRef.current,
      emitTelemetry,
      size: action.type === "write" ? "l" : "m",
    });
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
    setTool: (tool) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.setCurrentTool(tool);
      if (tool === "draw" || tool === "highlight") applyLearnerPenStyle(editor);
    },
    setPenStyle: (style) => {
      penStyleRef.current = style;
      const editor = editorRef.current;
      if (editor) applyLearnerPenStyle(editor, style);
    },
    zoomToPage: (pageId) => {
      const editor = editorRef.current;
      const page = pageImagesRef.current.get(pageId);
      if (!editor || !page) return;
      activePageIdRef.current = pageId;
      imageRef.current = page;
      editor.zoomToBounds(page, { animation: { duration: 220 }, inset: 88 });
      hasFittedCameraRef.current = true;
    },
    getActivePageId: () => activePageIdRef.current,
    exportActivePageComposite,
    hasLearnerInk,
  }), [beginTutorPerformance, renderTutorBeat, cancelTutorPerformance, cancelTutorInk, clearTutorInk, playTutorInk, exportActivePageComposite, hasLearnerInk, applyLearnerPenStyle]);

  const renderImage = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const renderToken = ++imageRenderTokenRef.current;
    const preserveCamera = hasFittedCameraRef.current;
    const cameraBefore = preserveCamera ? editor.getCamera() : null;
    deleteByRole("vision-region");
    const pageShapes = editor.getCurrentPageShapes().filter((shape) => shape.meta?.notebookProbeRole === "page-image");
    if (pageShapes.length) editor.deleteShapes(pageShapes.map((shape) => shape.id));
    pageImagesRef.current.clear();

    const sources: NotebookCanvasPage[] = pages?.length
      ? pages
      : imageUrl
        ? [{ id: "legacy-page", title: imageKey ?? "Page", imageUrl, pageNumber: 1 }]
        : [];

    await Promise.allSettled(sources.map(async (page, index) => {
      const size = await imageDimensions(page.imageUrl);
      if (renderToken !== imageRenderTokenRef.current || !editorRef.current) return;
      const scale = Math.min(1, 1100 / size.w);
      const image = {
        x: PAGE_ORIGIN.x + index * (1100 + PAGE_GAP),
        y: PAGE_ORIGIN.y,
        w: Math.round(size.w * scale),
        h: Math.round(size.h * scale),
      };
      pageImagesRef.current.set(page.id, image);
      const assetId = `asset:notebook-${page.id}` as TLAssetId;
      editor.createAssets([{
        id: assetId,
        typeName: "asset",
        type: "image",
        meta: { notebookProbeRole: "page-image", notebookPageId: page.id },
        props: { name: page.title, src: page.imageUrl, w: size.w, h: size.h, mimeType: page.imageUrl.startsWith("data:image/png") ? "image/png" : null, isAnimated: false },
      }] as Parameters<Editor["createAssets"]>[0]);
      editor.createShape({
        id: createShapeId(`notebook-page-${page.id}`),
        type: "image",
        x: image.x,
        y: image.y,
        isLocked: true,
        meta: { notebookProbeRole: "page-image", notebookPageId: page.id, pageNumber: page.pageNumber },
        props: { w: image.w, h: image.h, assetId, url: page.imageUrl, crop: null, flipX: false, flipY: false, playing: false, altText: `${page.title}, page ${page.pageNumber}` },
      } as Parameters<Editor["createShape"]>[0]);
    }));

    if (renderToken !== imageRenderTokenRef.current || !editorRef.current) return;

    const activeId = activePageIdRef.current;
    const activeImage = pageImagesRef.current.get(activeId) ?? pageImagesRef.current.values().next().value;
    if (activeImage) {
      imageRef.current = activeImage;
      if (!pageImagesRef.current.has(activeId)) {
        // Keep whatever page id we already had if the map missed it; do not force page 1.
        const first = [...pageImagesRef.current.entries()][0];
        if (first) activePageIdRef.current = first[0];
      }
    }

    if (preserveCamera && cameraBefore) {
      editor.setCamera(cameraBefore);
    } else if (activeImage) {
      editor.zoomToBounds(activeImage, { animation: { duration: 220 }, inset: 72 });
      hasFittedCameraRef.current = true;
    }
  }, [deleteByRole, imageKey, imageUrl, pages]);

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
    applyLearnerPenStyle(editor);
    editor.setCurrentTool("select");
    hasFittedCameraRef.current = false;

    const syncActivePageFromViewport = () => {
      const viewport = editor.getViewportPageBounds();
      if (!viewport || pageImagesRef.current.size === 0) return;
      const centerX = viewport.x + viewport.w / 2;
      const centerY = viewport.y + viewport.h / 2;
      let bestId = activePageIdRef.current;
      let bestScore = -1;
      for (const [pageId, page] of pageImagesRef.current) {
        const overlapW = Math.max(0, Math.min(page.x + page.w, viewport.x + viewport.w) - Math.max(page.x, viewport.x));
        const overlapH = Math.max(0, Math.min(page.y + page.h, viewport.y + viewport.h) - Math.max(page.y, viewport.y));
        const area = overlapW * overlapH;
        const containsCenter =
          centerX >= page.x && centerX <= page.x + page.w &&
          centerY >= page.y && centerY <= page.y + page.h;
        const score = area + (containsCenter ? page.w * page.h : 0);
        if (score > bestScore) {
          bestScore = score;
          bestId = pageId;
        }
      }
      if (bestScore <= 0 || bestId === activePageIdRef.current) return;
      activePageIdRef.current = bestId;
      imageRef.current = pageImagesRef.current.get(bestId) ?? imageRef.current;
      onActivePageChangeRef.current?.(bestId);
    };

    let viewportFrame = 0;
    const scheduleViewportSync = () => {
      if (viewportFrame) return;
      viewportFrame = window.requestAnimationFrame(() => {
        viewportFrame = 0;
        syncActivePageFromViewport();
      });
    };

    const cleanupSelection = editor.store.listen(() => {
      const selectedPage = editor.getSelectedShapes().find((shape) => typeof shape.meta?.notebookPageId === "string");
      const pageId = selectedPage?.meta?.notebookPageId;
      if (typeof pageId === "string" && pageId !== activePageIdRef.current && pageImagesRef.current.has(pageId)) {
        activePageIdRef.current = pageId;
        imageRef.current = pageImagesRef.current.get(pageId) ?? imageRef.current;
        onActivePageChangeRef.current?.(pageId);
      }
    }, { scope: "session" });

    const cleanupCamera = editor.store.listen(scheduleViewportSync, { scope: "session" });
    void renderImage().then(() => syncActivePageFromViewport());

    return () => {
      cleanupSelection();
      cleanupCamera();
      if (viewportFrame) window.cancelAnimationFrame(viewportFrame);
    };
  }, [applyLearnerPenStyle, renderImage]);

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
    onFocusGesture?.({
      points: [start.point, end],
      bounds: { x: minX, y: minY, w: Math.abs(end.x - start.point.x), h: Math.abs(end.y - start.point.y) },
    });
  }, [onFocusGesture, toNormalized]);

  return <div ref={canvasRef} className="absolute inset-0 touch-none studydeck-notebook-canvas" onPointerDownCapture={onFocusGesture ? pointerDown : undefined} onPointerUpCapture={onFocusGesture ? pointerUp : undefined}>
    <Tldraw hideUi onMount={onMount} persistenceKey={persistenceKey} licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY} />
  </div>;
});

function labelPointForPlacement(image: PageImage, box: ProbeRegion["box"], placement: "north" | "east" | "south" | "west") {
  const x = image.x + box.x * image.w;
  const y = image.y + box.y * image.h;
  const w = box.width * image.w;
  const h = box.height * image.h;
  const gap = 44;
  if (placement === "north") return { x: x + w / 2 - 40, y: Math.max(image.y + 12, y - gap) };
  if (placement === "south") return { x: x + w / 2 - 40, y: Math.min(image.y + image.h - 22, y + h + gap) };
  if (placement === "west") return { x: Math.max(image.x + 12, x - gap - 80), y: y + h / 2 - 12 };
  return { x: Math.min(image.x + image.w - 160, x + w + gap), y: y + h / 2 - 12 };
}

type InkColor = "violet" | "red" | "blue" | "green" | "orange";
type InkStroke = Array<{ x: number; y: number }>;

type ActiveInkAnimation = {
  planId: string;
  cancel: () => void;
};

type StartTracedBeatOptions = {
  editor: Editor;
  planId: string;
  beat: TutorInkBeat;
  cueAtMs: number;
  strokes: InkStroke[];
  color: InkColor;
  activeAnimations: Map<string, ActiveInkAnimation>;
  emitTelemetry: (event: TutorInkBeatTelemetry) => void;
  size?: "s" | "m" | "l";
};

type StartHandwrittenTextOptions = {
  editor: Editor;
  planId: string;
  beat: TutorInkBeat;
  cueAtMs: number;
  origin: { x: number; y: number };
  text: string;
  color: InkColor;
  activeAnimations: Map<string, ActiveInkAnimation>;
  emitTelemetry: (event: TutorInkBeatTelemetry) => void;
  size?: "s" | "m" | "l";
};

function startTracedBeat({ editor, planId, beat, cueAtMs, strokes, color, activeAnimations, emitTelemetry, size = "l" }: StartTracedBeatOptions) {
  const key = `${planId}:${beat.id}`;
  const cancel = traceStrokes(editor, strokes, color, beat.durationMs, {
    planId,
    beatId: beat.id,
    cueAtMs,
    size,
    onFirstPaint: (cueToPaintMs) => emitTelemetry({ planId, beatId: beat.id, kind: "first-paint", cueToPaintMs }),
    onComplete: (cueToPaintMs) => {
      activeAnimations.delete(key);
      emitTelemetry({ planId, beatId: beat.id, kind: "completed", cueToPaintMs });
    },
  });
  activeAnimations.set(key, { planId, cancel });
}

/**
 * Legible tldraw draw-font text that reveals character-by-character so it feels handwritten.
 */
function startHandwrittenTextBeat({
  editor,
  planId,
  beat,
  cueAtMs,
  origin,
  text,
  color,
  activeAnimations,
  emitTelemetry,
  size = "l",
}: StartHandwrittenTextOptions) {
  const key = `${planId}:${beat.id}`;
  const id = createShapeId(`write-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const full = text.trim();
  if (!full) return;

  editor.createShape({
    id,
    type: "text",
    x: origin.x,
    y: origin.y,
    isLocked: false,
    meta: { notebookProbeRole: "tutor-ink", planId, beatId: beat.id },
    props: {
      richText: richText(full.slice(0, 1)),
      color,
      size,
      font: "draw",
      autoSize: true,
      scale: 1,
    },
  } as Parameters<Editor["createShape"]>[0]);

  const startedAt = performance.now();
  let frameId: number | undefined;
  let cancelled = false;
  let firstPainted = false;
  let completed = false;
  const durationMs = Math.max(180, beat.durationMs);

  const frame = (now: number) => {
    if (cancelled) return;
    if (!firstPainted) {
      firstPainted = true;
      emitTelemetry({ planId, beatId: beat.id, kind: "first-paint", cueToPaintMs: Math.max(0, now - cueAtMs) });
    }
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const count = Math.max(1, Math.ceil(progress * full.length));
    editor.updateShape({
      id,
      type: "text",
      isLocked: progress >= 1,
      props: { richText: richText(full.slice(0, count)) },
    } as unknown as Parameters<Editor["updateShape"]>[0]);
    if (progress < 1) {
      frameId = window.requestAnimationFrame(frame);
    } else {
      completed = true;
      activeAnimations.delete(key);
      emitTelemetry({ planId, beatId: beat.id, kind: "completed", cueToPaintMs: Math.max(0, now - cueAtMs) });
    }
  };
  frameId = window.requestAnimationFrame(frame);

  activeAnimations.set(key, {
    planId,
    cancel: () => {
      if (cancelled || completed) return;
      cancelled = true;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (editor.getShape(id)) editor.deleteShapes([id]);
      activeAnimations.delete(key);
    },
  });
}

function richText(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph" as const, content: text ? [{ type: "text" as const, text }] : [] }],
  };
}

/**
 * Animate one or more freehand strokes as a single tutor-ink draw shape.
 * Cancelling removes only this unfinished trace.
 */
function traceStrokes(
  editor: Editor,
  strokes: InkStroke[],
  color: InkColor,
  durationMs: number,
  lifecycle: {
    planId: string;
    beatId: string;
    cueAtMs: number;
    size: "s" | "m" | "l";
    onFirstPaint: (cueToPaintMs: number) => void;
    onComplete: (cueToPaintMs: number) => void;
  },
) {
  const usable = strokes.filter((stroke) => stroke.length >= 2);
  if (!usable.length) return () => {};

  const origin = usable[0][0];
  const totalPoints = usable.reduce((sum, stroke) => sum + stroke.length, 0);
  const id = createShapeId(`trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  const toSegments = (revealedPoints: number) => {
    let remaining = Math.max(2, revealedPoints);
    const segments = [];
    for (const stroke of usable) {
      if (remaining <= 0) break;
      const count = Math.min(stroke.length, Math.max(remaining >= 2 || segments.length === 0 ? 2 : 0, remaining));
      if (count < 2) break;
      segments.push({
        type: "free" as const,
        points: stroke.slice(0, count).map((point) => ({ x: point.x - origin.x, y: point.y - origin.y, z: 0.5 })),
      });
      remaining -= count;
    }
    return compressLegacySegments(segments);
  };

  editor.createShape({
    id,
    type: "draw",
    x: origin.x,
    y: origin.y,
    isLocked: false,
    meta: { notebookProbeRole: "tutor-ink", planId: lifecycle.planId, beatId: lifecycle.beatId },
    props: { segments: toSegments(2), color, size: lifecycle.size, isComplete: false },
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
    const progress = Math.min(1, (now - startedAt) / Math.max(160, durationMs));
    const count = Math.max(2, Math.ceil(progress * totalPoints));
    editor.updateShape({
      id,
      type: "draw",
      isLocked: progress >= 1,
      props: { segments: toSegments(count), isComplete: progress >= 1 },
    } as unknown as Parameters<Editor["updateShape"]>[0]);
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

function shapeIntersectsBounds(shape: { x: number; y: number; props: object }, bounds: { x: number; y: number; w: number; h: number }) {
  const props = shape.props as Record<string, unknown>;
  const width = typeof props.w === "number" ? props.w : 80;
  const height = typeof props.h === "number" ? props.h : 80;
  const right = shape.x + width;
  const bottom = shape.y + height;
  return shape.x < bounds.x + bounds.w && right > bounds.x && shape.y < bounds.y + bounds.h && bottom > bounds.y;
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
