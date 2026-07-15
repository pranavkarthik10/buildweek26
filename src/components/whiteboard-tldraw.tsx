"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Editor,
  Tldraw,
  type TLEditorSnapshot,
  getSnapshot,
  loadSnapshot,
} from "@tldraw/tldraw";

import { applyWhiteboardCanvasActions } from "@/lib/whiteboard-canvas";
import type { WhiteboardCanvasAction } from "@/lib/whiteboard-types";

export type WhiteboardTldrawHandle = {
  getSnapshot: () => string | undefined;
  applyActions: (actions: WhiteboardCanvasAction[]) => void;
};

type WhiteboardTldrawProps = {
  snapshot?: string;
};

export const WhiteboardTldraw = forwardRef<
  WhiteboardTldrawHandle,
  WhiteboardTldrawProps
>(function WhiteboardTldraw({ snapshot }, ref) {
  const editorRef = useRef<Editor | null>(null);
  const hydratedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getSnapshot: () => {
      const editor = editorRef.current;
      if (!editor) return undefined;

      try {
        return JSON.stringify(getSnapshot(editor.store));
      } catch {
        return undefined;
      }
    },
    applyActions: (actions) => {
      const editor = editorRef.current;
      if (!editor) return;
      applyWhiteboardCanvasActions(editor, actions);
    },
  }));

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;

      if (snapshot && !hydratedRef.current) {
        try {
          const parsed = JSON.parse(snapshot) as TLEditorSnapshot;
          loadSnapshot(editor.store, parsed);
          hydratedRef.current = true;
        } catch {
          // Fresh canvas if snapshot is invalid.
        }
      }
    },
    [snapshot],
  );

  return (
    <div className="absolute inset-0">
      <Tldraw onMount={handleMount} />
    </div>
  );
});