"use client";

import {
  forwardRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Editor,
  Tldraw,
  createShapeId,
  type TLEditorSnapshot,
  getSnapshot,
  loadSnapshot,
} from "@tldraw/tldraw";

import { applyWhiteboardCanvasActions } from "@/lib/whiteboard-canvas";
import type { WhiteboardCanvasAction } from "@/lib/whiteboard-types";
import type { BoardTransaction } from "@/lib/whiteboard-transaction";
import { validateBoardTransaction } from "@/lib/whiteboard-transaction";

export type WhiteboardTldrawHandle = {
  getSnapshot: () => string | undefined;
  getBoardImage: () => Promise<string | undefined>;
  getVersion: () => number;
  getSemanticShapes: () => SemanticShape[];
  getSemanticDiff: (sinceVersion?: number) => {
    version: number;
    reset: boolean;
    created: SemanticShape[];
    updated: SemanticShape[];
    deleted: string[];
  };
  applyActions: (actions: WhiteboardCanvasAction[]) => void;
  applyTransaction: (transaction: BoardTransaction) => {
    ok: boolean;
    error?: string;
    code?: "invalid" | "conflict" | "duplicate";
    currentVersion?: number;
  };
};

type SemanticShape = {
    id: string;
    type: string;
    x: number;
    y: number;
    props: Record<string, unknown>;
};

type WhiteboardTldrawProps = {
  snapshot?: string;
  initialVersion?: number;
  onSnapshotChange?: (snapshot: string) => void;
};

export const WhiteboardTldraw = forwardRef<
  WhiteboardTldrawHandle,
  WhiteboardTldrawProps
>(function WhiteboardTldraw({ snapshot, initialVersion = 0, onSnapshotChange }, ref) {
  const editorRef = useRef<Editor | null>(null);
  const snapshotRef = useRef(snapshot);
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  const loadedSnapshotRef = useRef<string | null>(null);
  const versionRef = useRef(initialVersion);
  const transactionIdsRef = useRef(new Set<string>());
  const semanticHistoryRef = useRef(new Map<number, Map<string, SemanticShape>>());

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    onSnapshotChangeRef.current = onSnapshotChange;
  }, [onSnapshotChange]);

  useEffect(() => {
    versionRef.current = Math.max(versionRef.current, initialVersion);
  }, [initialVersion]);

  useImperativeHandle(ref, () => ({
    getSnapshot: () => {
      const editor = editorRef.current;
      if (!editor) return undefined;

      try {
        // Persist the document records only. Camera and selection are local to
        // the learner and should not replay on another device.
        return JSON.stringify(getSnapshot(editor.store).document);
      } catch {
        return undefined;
      }
    },
    getVersion: () => versionRef.current,
    getBoardImage: async () => {
      const editor = editorRef.current;
      if (!editor || editor.getCurrentPageShapes().length === 0) return undefined;
      try {
        const image = await editor.toImageDataUrl(editor.getCurrentPageShapes(), { format: "png", scale: 0.75 });
        return image.url.length <= 1_500_000 ? image.url : undefined;
      } catch {
        return undefined;
      }
    },
    getSemanticShapes: () => {
      const editor = editorRef.current;
      if (!editor) return [];
      return editor.getCurrentPageShapes().map((shape) => ({
        id: shape.id,
        type: shape.type,
        x: shape.x,
        y: shape.y,
        props: shape.props as Record<string, unknown>,
      }));
    },
    getSemanticDiff: (sinceVersion) => {
      const currentShapes = editorRef.current ? editorRef.current.getCurrentPageShapes().map((shape) => ({
        id: shape.id,
        type: shape.type,
        x: shape.x,
        y: shape.y,
        props: shape.props as Record<string, unknown>,
      })) : [];
      const current = new Map<string, SemanticShape>(currentShapes.map((shape) => [shape.id, shape]));
      const previous = sinceVersion === undefined ? undefined : semanticHistoryRef.current.get(sinceVersion);
      if (!previous) {
        return { version: versionRef.current, reset: true, created: currentShapes, updated: [], deleted: [] };
      }
      const created: SemanticShape[] = [];
      const updated: SemanticShape[] = [];
      for (const [id, shape] of current) {
        const before = previous.get(id);
        if (!before) created.push(shape);
        else if (JSON.stringify(before) !== JSON.stringify(shape)) updated.push(shape);
      }
      const deleted = [...previous.keys()].filter((id) => !current.has(id));
      return { version: versionRef.current, reset: false, created, updated, deleted };
    },
    applyActions: (actions) => {
      const editor = editorRef.current;
      if (!editor) return;
      applyWhiteboardCanvasActions(editor, actions);
    },
    applyTransaction: (transaction) => {
      const duplicate = transactionIdsRef.current.has(transaction.transactionId);
      if (duplicate) return { ok: true, code: "duplicate" as const, currentVersion: versionRef.current };
      const validation = validateBoardTransaction(transaction, versionRef.current);
      if (!validation.ok) return validation;
      const editor = editorRef.current;
      if (!editor) return { ok: false, code: "invalid" as const, error: "Board is not mounted." };
      const existingShapeCount = validation.transaction.ops
        .filter((op) => Boolean(editor.getShape(createShapeId(op.id))))
        .length;
      if (existingShapeCount === validation.transaction.ops.length) {
        transactionIdsRef.current.add(transaction.transactionId);
        return { ok: true, code: "duplicate" as const, currentVersion: versionRef.current };
      }
      if (existingShapeCount > 0) {
        return {
          ok: false,
          code: "conflict" as const,
          error: "Some transaction shape IDs already exist; reread the board before retrying.",
          currentVersion: versionRef.current,
        };
      }
      try {
        applyWhiteboardCanvasActions(editor, validation.transaction.ops);
      } catch {
        return { ok: false, code: "invalid" as const, error: "The board update could not be applied." };
      }
      transactionIdsRef.current.add(transaction.transactionId);
      if (transactionIdsRef.current.size > 100) {
        transactionIdsRef.current.delete(transactionIdsRef.current.values().next().value as string);
      }
      return { ok: true, currentVersion: versionRef.current };
    },
  }));

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;

    const initialSnapshot = snapshotRef.current;
    if (initialSnapshot) {
      try {
        const parsed = JSON.parse(initialSnapshot) as TLEditorSnapshot | TLEditorSnapshot["document"];
        loadSnapshot(editor.store, "document" in parsed ? parsed.document : parsed);
        loadedSnapshotRef.current = initialSnapshot;
      } catch {
        // Fresh canvas if snapshot is invalid.
      }
    }

    editor.store.listen(
      () => {
        versionRef.current += 1;
        const shapes = editor.getCurrentPageShapes().map((shape) => ({
          id: shape.id,
          type: shape.type,
          x: shape.x,
          y: shape.y,
          props: shape.props as Record<string, unknown>,
        }));
        semanticHistoryRef.current.set(versionRef.current, new Map<string, SemanticShape>(shapes.map((shape) => [shape.id, shape])));
        while (semanticHistoryRef.current.size > 24) {
          const oldest = semanticHistoryRef.current.keys().next().value;
          if (oldest === undefined) break;
          semanticHistoryRef.current.delete(oldest);
        }
        try {
          const serialized = JSON.stringify(getSnapshot(editor.store).document);
          onSnapshotChangeRef.current?.(serialized);
        } catch {
          // Ignore transient store serialization failures.
        }
      },
      { scope: "document" },
    );

    // Publish the hydrated document once so the parent can retain semantic
    // board context even when the panel is later hidden and remounted.
    try {
      const serialized = JSON.stringify(getSnapshot(editor.store).document);
      onSnapshotChangeRef.current?.(serialized);
      const shapes = editor.getCurrentPageShapes().map((shape) => ({
        id: shape.id,
        type: shape.type,
        x: shape.x,
        y: shape.y,
        props: shape.props as Record<string, unknown>,
      }));
      semanticHistoryRef.current.set(
        versionRef.current,
        new Map<string, SemanticShape>(shapes.map((shape) => [shape.id, shape])),
      );
    } catch {
      // Ignore transient hydration serialization failures.
    }
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const nextSnapshot = snapshotRef.current;
    if (!editor || !nextSnapshot || nextSnapshot === loadedSnapshotRef.current) {
      return;
    }

    try {
      const parsed = JSON.parse(nextSnapshot) as TLEditorSnapshot | TLEditorSnapshot["document"];
      loadSnapshot(editor.store, "document" in parsed ? parsed.document : parsed);
      loadedSnapshotRef.current = nextSnapshot;
    } catch {
      // Fresh canvas if snapshot is invalid.
    }
  }, [snapshot]);

  return (
    <div className="absolute inset-0">
      <Tldraw
        onMount={handleMount}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
      />
    </div>
  );
});
