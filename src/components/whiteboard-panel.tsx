"use client";

import dynamic from "next/dynamic";
import katex from "katex";
import { useEffect, useId, useMemo, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";

import type { WhiteboardContent, WhiteboardStroke } from "@/lib/aiprof-types";
import type { WhiteboardTldrawHandle } from "@/components/whiteboard-tldraw";

import "katex/dist/katex.min.css";
import "@tldraw/tldraw/tldraw.css";

const TldrawCanvas = dynamic(
  () =>
    import("@/components/whiteboard-tldraw").then((m) => m.WhiteboardTldraw),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-[#5c5c58]">
        Loading canvas…
      </div>
    ),
  },
);

const MODE_LABELS: Record<WhiteboardContent["mode"], string> = {
  canvas: "Canvas",
  manim: "Animation",
  latex: "Formula",
  text: "Notes",
  strokes: "Diagram",
};

type WhiteboardPanelProps = {
  content: WhiteboardContent;
  onClose?: () => void;
  className?: string;
  canvasRef?: React.RefObject<WhiteboardTldrawHandle | null>;
  status?: string;
};

export function WhiteboardPanel({
  content,
  onClose,
  className = "",
  canvasRef,
  status,
}: WhiteboardPanelProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!fullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  const shellClass = fullscreen
    ? "fixed inset-0 z-[80] flex flex-col bg-[#f4f4ef]"
    : `relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-white/8 bg-[#f7f7f2] shadow-[0_30px_90px_rgba(0,0,0,0.36)] ${className}`;

  return (
    <aside
      id={panelId}
      className={shellClass}
      aria-label="Whiteboard"
      data-fullscreen={fullscreen ? "true" : "false"}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-black/6 bg-[#efefe8] px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-[#3d3d38]">
            {content.title ?? "Whiteboard"}
          </p>
          <p className="truncate text-[0.65rem] text-[#7a7a72]">
            {status ?? MODE_LABELS[content.mode]}
          </p>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className="rounded-md p-1.5 text-[#5c5c58] transition hover:bg-black/6 hover:text-[#2a2a26]"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-[#5c5c58] transition hover:bg-black/6 hover:text-[#2a2a26]"
              title="Close whiteboard"
              aria-label="Close whiteboard"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <WhiteboardBody content={content} canvasRef={canvasRef} />
      </div>
    </aside>
  );
}

function WhiteboardBody({
  content,
  canvasRef,
}: {
  content: WhiteboardContent;
  canvasRef?: React.RefObject<WhiteboardTldrawHandle | null>;
}) {
  switch (content.mode) {
    case "canvas":
      return (
        <TldrawCanvas ref={canvasRef} snapshot={content.tldrawSnapshot} />
      );
    case "manim":
      return <ManimView content={content} />;
    case "latex":
      return <LatexView content={content} />;
    case "text":
      return <TextView content={content} />;
    case "strokes":
      return <StrokesView strokes={content.strokes ?? []} />;
    default:
      return null;
  }
}

function ManimView({ content }: { content: WhiteboardContent }) {
  const code = content.manimCode?.trim();

  return (
    <div className="flex h-full flex-col">
      {content.manimVideoUrl ? (
        <div className="shrink-0 border-b border-black/6 bg-black">
          <video
            src={content.manimVideoUrl}
            controls
            className="max-h-[42%] w-full object-contain"
            playsInline
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-black/6 px-3 py-2 text-[0.65rem] text-[#7a7a72]">
          <span>Manim scene (render separately)</span>
          <a
            href="https://www.manim.community/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#2563eb] hover:underline"
          >
            manim.community
          </a>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto border-0 bg-[#1a1b1e] p-4 font-mono text-[0.72rem] leading-relaxed text-[#e8e6e3]">
          {code || "No scene code provided."}
        </pre>
      </div>
    </div>
  );
}

function LatexView({ content }: { content: WhiteboardContent }) {
  const latex = content.latex?.trim() ?? "";
  const rendered = useMemo(() => renderLatexBlocks(latex), [latex]);

  return (
    <div
      className="h-full overflow-auto p-6"
      aria-live="polite"
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

function TextView({ content }: { content: WhiteboardContent }) {
  const text = content.text?.trim();

  if (!text) {
    return (
      <p className="p-6 text-sm text-[#7a7a72]">No notes on the board.</p>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 text-[0.95rem] leading-8 whitespace-pre-wrap text-[#2a2a26]">
      {text}
    </div>
  );
}

function StrokesView({ strokes }: { strokes: WhiteboardStroke[] }) {
  if (strokes.length === 0) {
    return (
      <p className="p-6 text-sm text-[#7a7a72]">No diagram marks.</p>
    );
  }

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {strokes.map((stroke) => {
        const color = stroke.color || "#2563eb";

        if (stroke.kind === "circle") {
          const radius = Math.max(
            4,
            Math.abs((stroke.x2 ?? stroke.x1 + 12) - stroke.x1),
          );
          return (
            <circle
              key={stroke.id}
              cx={stroke.x1}
              cy={stroke.y1}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="1.6"
            />
          );
        }

        if (stroke.kind === "text") {
          return (
            <text
              key={stroke.id}
              x={stroke.x1}
              y={stroke.y1}
              fill={color}
              fontSize="5"
              fontFamily="sans-serif"
            >
              {stroke.text}
            </text>
          );
        }

        return (
          <g key={stroke.id}>
            <line
              x1={stroke.x1}
              y1={stroke.y1}
              x2={stroke.x2 ?? stroke.x1 + 18}
              y2={stroke.y2 ?? stroke.y1}
              stroke={color}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            {stroke.kind === "arrow" ? (
              <circle
                cx={stroke.x2 ?? stroke.x1 + 18}
                cy={stroke.y2 ?? stroke.y1}
                r="2"
                fill={color}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function renderLatexBlocks(source: string) {
  const blocks = source
    .split(/\n{2,}|\n(?=\\)/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return `<p class="text-sm text-[#7a7a72]">No formulas on the board.</p>`;
  }

  return blocks
    .map((block) => {
      try {
        const html = katex.renderToString(block, {
          displayMode: true,
          throwOnError: false,
          strict: "ignore",
        });
        return `<div class="mb-6 flex justify-center overflow-x-auto">${html}</div>`;
      } catch {
        return `<pre class="mb-4 rounded bg-red-50 px-3 py-2 text-xs text-red-800">${escapeHtml(block)}</pre>`;
      }
    })
    .join("");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
