"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";

import type { WhiteboardContent } from "@/lib/aiprof-types";
import type { WhiteboardTldrawHandle } from "@/components/whiteboard-tldraw";

import "@tldraw/tldraw/tldraw.css";

const TldrawCanvas = dynamic(() => import("@/components/whiteboard-tldraw").then((module) => module.WhiteboardTldraw), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-[#5c5c58]">Loading canvas…</div>,
});

type WhiteboardPanelProps = {
  content: WhiteboardContent;
  onClose?: () => void;
  className?: string;
  canvasRef?: React.RefObject<WhiteboardTldrawHandle | null>;
  initialVersion?: number;
  onSnapshotChange?: (snapshot: string) => void;
  status?: string;
};

export function WhiteboardPanel({ content, onClose, className = "", canvasRef, initialVersion, onSnapshotChange, status }: WhiteboardPanelProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [fullscreen]);

  const shellClass = fullscreen
    ? "fixed inset-0 z-[80] flex flex-col bg-[#f4f4ef]"
    : `relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-white/8 bg-[#f7f7f2] shadow-[0_30px_90px_rgba(0,0,0,0.36)] ${className}`;

  return <aside id={panelId} className={shellClass} aria-label="studydeck canvas" data-fullscreen={fullscreen ? "true" : "false"}>
    <header className="flex shrink-0 items-center gap-2 border-b border-black/6 bg-[#efefe8] px-3 py-2">
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-[#3d3d38]">{content.title ?? "Whiteboard"}</p><p className="truncate text-[0.65rem] text-[#7a7a72]">{status ?? "Living canvas · student and tutor marks persist"}</p></div>
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => setFullscreen((value) => !value)} className="rounded-md p-1.5 text-[#5c5c58] transition hover:bg-black/6 hover:text-[#2a2a26]" title={fullscreen ? "Exit fullscreen" : "Fullscreen"} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>{fullscreen ? <Minimize2 className="h-4 w-4" strokeWidth={1.75} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.75} />}</button>
        {onClose ? <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[#5c5c58] transition hover:bg-black/6 hover:text-[#2a2a26]" title="Close canvas" aria-label="Close canvas"><X className="h-4 w-4" strokeWidth={1.75} /></button> : null}
      </div>
    </header>
    <div className="relative min-h-0 flex-1 overflow-hidden"><TldrawCanvas ref={canvasRef} snapshot={content.tldrawSnapshot} initialVersion={initialVersion} onSnapshotChange={onSnapshotChange} /></div>
  </aside>;
}
