"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- tldraw's public TLShape union requires declaration merging for custom records. */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import katex from "katex";
import {
  ShapeUtil,
  Editor,
  HTMLContainer,
  Rectangle2d,
  T,
  Tldraw,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  createShapeId,
  getSnapshot,
  loadSnapshot,
  type TLBaseShape,
  type TLEditorSnapshot,
} from "@tldraw/tldraw";

import { VisualArtifactShape } from "@/components/visual-artifact-shape";
import { applyWhiteboardCanvasActions } from "@/lib/whiteboard-canvas";
import type { WhiteboardCanvasAction } from "@/lib/whiteboard-types";
import type { BoardTransaction } from "@/lib/whiteboard-transaction";
import { validateBoardTransaction } from "@/lib/whiteboard-transaction";

export type SemanticShape = { id: string; type: string; x: number; y: number; props: Record<string, unknown> };

type VisualShape = TLBaseShape<"studydeck-visual", {
  artifactId: string;
  engine: string;
  title: string;
  status: string;
  artifactUrl: string;
  specUrl: string;
  w: number;
  h: number;
}>;
type FormulaShape = TLBaseShape<"studydeck-formula", { latex: string; w: number; h: number }>;

class VisualShapeUtil extends ShapeUtil<any> {
  static override type = "studydeck-visual" as const;
  static override props = {
    artifactId: T.string,
    engine: T.string,
    title: T.string,
    status: T.string,
    artifactUrl: T.string,
    specUrl: T.string,
    w: T.number,
    h: T.number,
  };
  static override migrations = createShapePropsMigrationSequence({
    sequence: [
      { id: createShapePropsMigrationIds("studydeck-visual", { AddArtifactLinks: 1 }).AddArtifactLinks, up: (props) => ({ artifactUrl: "", specUrl: "", ...props }) },
      { id: createShapePropsMigrationIds("studydeck-visual", { AddStatus: 2 }).AddStatus, up: (props) => ({ status: "queued", ...props }) },
    ],
  });

  override getDefaultProps(): VisualShape["props"] {
    return { artifactId: "", engine: "diagram", title: "studydeck visual", status: "queued", artifactUrl: "", specUrl: "", w: 520, h: 340 };
  }

  override getGeometry(shape: VisualShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override onResize(shape: VisualShape, info: { initialBounds: { width: number; height: number }; scaleX: number; scaleY: number }) {
    return { props: { ...shape.props, w: Math.max(240, info.initialBounds.width * info.scaleX), h: Math.max(160, info.initialBounds.height * info.scaleY) } };
  }

  override component(shape: VisualShape) {
    return <HTMLContainer className="studydeck-visual-shape"><VisualArtifactShape {...shape.props} /></HTMLContainer>;
  }

  override getIndicatorPath(shape: VisualShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}

class FormulaShapeUtil extends ShapeUtil<any> {
  static override type = "studydeck-formula" as const;
  static override props = { latex: T.string, w: T.number, h: T.number };
  static override migrations = createShapePropsMigrationSequence({ sequence: [{ id: createShapePropsMigrationIds("studydeck-formula", { Initial: 1 }).Initial, up: (props) => ({ w: 420, h: 120, ...props }) }] });
  override getDefaultProps(): FormulaShape["props"] { return { latex: "x^2", w: 420, h: 120 }; }
  override getGeometry(shape: FormulaShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true }); }
  override component(shape: FormulaShape) {
    const html = katex.renderToString(shape.props.latex.slice(0, 400), { displayMode: true, throwOnError: false, strict: "ignore" });
    return <HTMLContainer className="rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="flex h-full items-center justify-center overflow-auto" dangerouslySetInnerHTML={{ __html: html }} /></HTMLContainer>;
  }
  override getIndicatorPath(shape: FormulaShape) { const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 12); return path; }
}

export type WhiteboardTldrawHandle = {
  whenReady: () => Promise<void>;
  getSnapshot: () => string | undefined;
  getBoardImage: () => Promise<string | undefined>;
  getVersion: () => number;
  getSemanticShapes: () => SemanticShape[];
  getSemanticDiff: (sinceVersion?: number) => { version: number; reset: boolean; created: SemanticShape[]; updated: SemanticShape[]; deleted: string[] };
  applyActions: (actions: WhiteboardCanvasAction[]) => Promise<boolean>;
  applyTransaction: (transaction: BoardTransaction) => { ok: boolean; error?: string; code?: "invalid" | "conflict" | "duplicate"; currentVersion?: number };
  insertVisualArtifact: (artifact: { id: string; engine: string; title?: string; status: string; artifactUrl?: string; specUrl?: string }) => boolean;
};

type WhiteboardTldrawProps = { snapshot?: string; initialVersion?: number; onSnapshotChange?: (snapshot: string) => void };

export const WhiteboardTldraw = forwardRef<WhiteboardTldrawHandle, WhiteboardTldrawProps>(function WhiteboardTldraw({ snapshot, initialVersion = 0, onSnapshotChange }, ref) {
  const editorRef = useRef<Editor | null>(null);
  const snapshotRef = useRef(snapshot);
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  const loadedSnapshotRef = useRef<string | null>(null);
  const versionRef = useRef(initialVersion);
  const transactionIdsRef = useRef(new Set<string>());
  const semanticHistoryRef = useRef(new Map<number, Map<string, SemanticShape>>());
  const readyResolversRef = useRef<Array<() => void>>([]);

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { onSnapshotChangeRef.current = onSnapshotChange; }, [onSnapshotChange]);
  useEffect(() => { versionRef.current = Math.max(versionRef.current, initialVersion); }, [initialVersion]);

  const whenReady = useCallback(() => {
    if (editorRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => readyResolversRef.current.push(resolve));
  }, []);

  useImperativeHandle(ref, () => ({
    whenReady,
    getSnapshot: () => {
      const editor = editorRef.current;
      if (!editor) return undefined;
      try { return JSON.stringify(getSnapshot(editor.store).document); } catch { return undefined; }
    },
    getVersion: () => versionRef.current,
    getBoardImage: async () => {
      const editor = editorRef.current;
      if (!editor || editor.getCurrentPageShapes().length === 0) return undefined;
      try {
        const image = await editor.toImageDataUrl(editor.getCurrentPageShapes(), { format: "png", scale: 0.75 });
        return image.url.length <= 1_500_000 ? image.url : undefined;
      } catch { return undefined; }
    },
    getSemanticShapes: () => editorRef.current?.getCurrentPageShapes().map((shape) => ({ id: shape.id, type: shape.type, x: shape.x, y: shape.y, props: shape.props as Record<string, unknown> })) ?? [],
    getSemanticDiff: (sinceVersion) => {
      const currentShapes = editorRef.current?.getCurrentPageShapes().map((shape) => ({ id: shape.id, type: shape.type, x: shape.x, y: shape.y, props: shape.props as Record<string, unknown> })) ?? [];
      const current = new Map<string, SemanticShape>(currentShapes.map((shape) => [String(shape.id), shape]));
      const previous = sinceVersion === undefined ? undefined : semanticHistoryRef.current.get(sinceVersion);
      if (!previous) return { version: versionRef.current, reset: true, created: currentShapes, updated: [], deleted: [] };
      const created: SemanticShape[] = [], updated: SemanticShape[] = [];
      for (const [id, shape] of current) { const before = previous.get(id); if (!before) created.push(shape); else if (JSON.stringify(before) !== JSON.stringify(shape)) updated.push(shape); }
      return { version: versionRef.current, reset: false, created, updated, deleted: [...previous.keys()].filter((id) => !current.has(id)) };
    },
    applyActions: async (actions) => { await whenReady(); const editor = editorRef.current; if (!editor) return false; applyWhiteboardCanvasActions(editor, actions); return true; },
    applyTransaction: (transaction) => {
      const duplicate = transactionIdsRef.current.has(transaction.transactionId);
      if (duplicate) return { ok: true, code: "duplicate" as const, currentVersion: versionRef.current };
      const validation = validateBoardTransaction(transaction, versionRef.current);
      if (!validation.ok) return validation;
      const editor = editorRef.current;
      if (!editor) return { ok: false, code: "invalid" as const, error: "Board is not ready." };
      const ids = validation.transaction.ops.map((op) => createShapeId(op.id));
      const existing = ids.filter((id) => Boolean(editor.getShape(id))).length;
      if (existing === ids.length) { transactionIdsRef.current.add(transaction.transactionId); return { ok: true, code: "duplicate" as const, currentVersion: versionRef.current }; }
      if (existing > 0) return { ok: false, code: "conflict" as const, error: "Some transaction shape IDs already exist; reread the board before retrying.", currentVersion: versionRef.current };
      try { applyWhiteboardCanvasActions(editor, validation.transaction.ops); } catch { return { ok: false, code: "invalid" as const, error: "The board update could not be applied." }; }
      transactionIdsRef.current.add(transaction.transactionId);
      if (transactionIdsRef.current.size > 100) transactionIdsRef.current.delete(transactionIdsRef.current.values().next().value as string);
      return { ok: true, currentVersion: versionRef.current };
    },
    insertVisualArtifact: (artifact) => {
      const editor = editorRef.current;
      if (!editor) return false;
      const id = createShapeId(`visual-${artifact.id}`);
      const existingShape = editor.getShape(id) as any;
      if (existingShape) {
        editor.updateShape({ ...existingShape, props: { ...existingShape.props, engine: artifact.engine, status: artifact.status, artifactUrl: artifact.artifactUrl ?? existingShape.props.artifactUrl ?? "", specUrl: artifact.specUrl ?? existingShape.props.specUrl ?? "" } } as any);
        editor.select(id);
        const existingBounds = editor.getShapePageBounds(id);
        if (existingBounds) editor.zoomToBounds(existingBounds, { animation: { duration: 220 } });
        return true;
      }
      const existing = editor.getCurrentPageShapes().filter((shape) => String(shape.type) === "studydeck-visual");
      const col = existing.length % 2, row = Math.floor(existing.length / 2);
      editor.createShape({ id, type: "studydeck-visual", x: 80 + col * 560, y: 80 + row * 390, props: { artifactId: artifact.id, engine: artifact.engine, title: artifact.title ?? "studydeck visual", status: artifact.status, artifactUrl: artifact.artifactUrl ?? "", specUrl: artifact.specUrl ?? "", w: 520, h: 340 } } as any);
      editor.select(id);
      const bounds = editor.getShapePageBounds(id);
      if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 240 }, inset: 80 });
      return true;
    },
  }), [whenReady]);

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    const initialSnapshot = snapshotRef.current;
    if (initialSnapshot) {
      try { const parsed = JSON.parse(initialSnapshot) as TLEditorSnapshot | TLEditorSnapshot["document"]; loadSnapshot(editor.store, "document" in parsed ? parsed.document : parsed); loadedSnapshotRef.current = initialSnapshot; } catch { /* keep a fresh board */ }
    }
    for (const resolve of readyResolversRef.current.splice(0)) resolve();
    const publish = () => {
      versionRef.current += 1;
      const shapes = editor.getCurrentPageShapes().map((shape) => ({ id: shape.id, type: shape.type, x: shape.x, y: shape.y, props: shape.props as Record<string, unknown> }));
      semanticHistoryRef.current.set(versionRef.current, new Map(shapes.map((shape) => [shape.id, shape])));
      while (semanticHistoryRef.current.size > 24) { const oldest = semanticHistoryRef.current.keys().next().value; if (oldest === undefined) break; semanticHistoryRef.current.delete(oldest); }
      try { onSnapshotChangeRef.current?.(JSON.stringify(getSnapshot(editor.store).document)); } catch { /* transient store state */ }
    };
    const cleanup = editor.store.listen(publish, { scope: "document" });
    try { onSnapshotChangeRef.current?.(JSON.stringify(getSnapshot(editor.store).document)); } catch { /* transient store state */ }
    semanticHistoryRef.current.set(versionRef.current, new Map(editor.getCurrentPageShapes().map((shape) => [shape.id, { id: shape.id, type: shape.type, x: shape.x, y: shape.y, props: shape.props as Record<string, unknown> }])));
    return cleanup;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const nextSnapshot = snapshotRef.current;
    if (!editor || !nextSnapshot || nextSnapshot === loadedSnapshotRef.current) return;
    try { const parsed = JSON.parse(nextSnapshot) as TLEditorSnapshot | TLEditorSnapshot["document"]; loadSnapshot(editor.store, "document" in parsed ? parsed.document : parsed); loadedSnapshotRef.current = nextSnapshot; } catch { /* ignore malformed snapshots */ }
  }, [snapshot]);

  return <div className="absolute inset-0 studydeck-canvas"><Tldraw onMount={handleMount} shapeUtils={[VisualShapeUtil, FormulaShapeUtil]} licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY} /></div>;
});
