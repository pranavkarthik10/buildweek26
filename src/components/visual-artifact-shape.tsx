"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { VisualExplainerSpec, VisualNode, PlotlyVisualSpec, JSXGraphVisualSpec } from "@/lib/explainer-types";

type Props = {
  artifactId: string;
  engine: string;
  title: string;
  status: string;
  artifactUrl?: string;
  specUrl?: string;
};

export function VisualArtifactShape({ artifactId, engine, title, status, artifactUrl, specUrl }: Props) {
  const [spec, setSpec] = useState<VisualExplainerSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interactive, setInteractive] = useState(false);
  void artifactId;

  useEffect(() => {
    if (!specUrl) return;
    let cancelled = false;
    fetch(specUrl, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Visual specification unavailable.")))
      .then((payload: { spec?: VisualExplainerSpec }) => {
        if (!cancelled) setSpec(payload.spec ?? null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Visual specification unavailable.");
      });
    return () => { cancelled = true; };
  }, [specUrl]);

  if (artifactUrl && engine === "manim" && status !== "failed") {
    return <video src={artifactUrl} controls playsInline className="h-full w-full rounded-xl bg-slate-950 object-contain" />;
  }

  if (status === "queued" || status === "processing") {
    return <VisualShell title={title} badge={`${engine} · ${status}`}><div className="flex h-full items-center justify-center text-sm text-slate-500"><span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-cyan-500" />Building a visual model…</div></VisualShell>;
  }
  if (error || status === "failed") {
    return <VisualShell title={title} badge="live board fallback"><div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">{error ?? "The visual could not be rendered. The tutor kept the board intact."}</div></VisualShell>;
  }
  if (!spec) {
    return <VisualShell title={title} badge={`${engine} visual`}><div className="flex h-full items-center justify-center text-sm text-slate-500">Loading visual…</div></VisualShell>;
  }

  return <VisualShell title={spec.title || title} badge={`${spec.engine} visual`} action={spec.engine === "plotly" || spec.engine === "jsxgraph" ? <button type="button" className="rounded bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-700" onClick={() => setInteractive((value) => !value)}>{interactive ? "Exit interact" : "Interact"}</button> : undefined}><VisualSpecView spec={spec} interactive={interactive} /></VisualShell>;
}

function VisualShell({ title, badge, action, children }: { title: string; badge: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
      <span className="truncate text-xs font-semibold">{title}</span>
      <div className="flex items-center gap-2">{action}<span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-700">{badge}</span></div>
    </div>
    <div className="min-h-0 flex-1 p-3">{children}</div>
  </div>;
}

function VisualSpecView({ spec, interactive }: { spec: VisualExplainerSpec; interactive: boolean }) {
  switch (spec.visual.engine) {
    case "diagram": return <DiagramView nodes={spec.visual.nodes} edges={spec.visual.edges} />;
    case "plotly": return interactive ? <PlotlyInteractive visual={spec.visual} /> : <PlotView visual={spec.visual} />;
    case "jsxgraph": return interactive ? <JSXGraphInteractive visual={spec.visual} /> : <GraphView visual={spec.visual} />;
    case "manim": return <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">Video is being prepared with the math animation renderer.</div>;
  }
}

type PlotlyModule = { newPlot: (node: HTMLElement, data: unknown[], layout: unknown, config?: unknown) => Promise<unknown>; purge: (node: HTMLElement) => void };
function PlotlyInteractive({ visual }: { visual: PlotlyVisualSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const node = ref.current;
    void import("plotly.js-basic-dist-min").then((module) => {
      if (cancelled || !node) return;
      const plotly = module as unknown as PlotlyModule;
      const traces = visual.series.map((series) => ({ x: visual.x, y: series.values, name: series.name, type: visual.chartType === "bar" ? "bar" : "scatter", mode: visual.chartType === "scatter" ? "markers+lines" : undefined, marker: { color: series.color } }));
      return plotly.newPlot(node, traces, { margin: { t: 12, r: 12, b: 35, l: 40 }, paper_bgcolor: "transparent", plot_bgcolor: "transparent", xaxis: { title: visual.xLabel }, yaxis: { title: visual.yLabel } }, { displayModeBar: false, responsive: true });
    }).catch(() => undefined);
    return () => { cancelled = true; if (node) void import("plotly.js-basic-dist-min").then((module) => (module as unknown as PlotlyModule).purge(node)).catch(() => undefined); };
  }, [visual]);
  return <div ref={ref} className="h-full w-full" aria-label="Interactive chart" />;
}

type JSXGraphModule = { JSXGraph: { initBoard: (id: string, options: Record<string, unknown>) => { create: (type: string, args: unknown[], options?: Record<string, unknown>) => unknown; freeBoard: () => void } } };
function JSXGraphInteractive({ visual }: { visual: JSXGraphVisualSpec }) {
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    let board: { create: (type: string, args: unknown[], options?: Record<string, unknown>) => unknown; freeBoard: () => void } | undefined;
    void import("jsxgraph").then((module) => {
      const api = module as unknown as JSXGraphModule;
      board = api.JSXGraph.initBoard(id, { boundingbox: [visual.viewport.xMin, visual.viewport.yMax, visual.viewport.xMax, visual.viewport.yMin], axis: true, showNavigation: false, showCopyright: false });
      for (const object of visual.objects) {
        if (object.type === "point") board.create("point", [object.x, object.y], { name: object.label ?? object.id, size: 3 });
        if (object.type === "segment") board.create("segment", [object.from, object.to], { name: object.label ?? object.id });
        if (object.type === "circle") board.create("circle", [object.center, object.radius], { name: object.label ?? object.id });
        if (object.type === "slider") board.create("slider", [[visual.viewport.xMin, visual.viewport.yMin + 0.5], [visual.viewport.xMin + 2, visual.viewport.yMin + 0.5], [object.min, object.value, object.max]], { name: object.label });
      }
    }).catch(() => undefined);
    return () => board?.freeBoard();
  }, [id, visual]);
  return <div id={id} className="h-full w-full" aria-label="Interactive geometry" />;
}

function DiagramView({ nodes, edges }: { nodes: VisualNode[]; edges: Array<{ id: string; from: string; to: string; label?: string }> }) {
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  return <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label="Concept diagram">
    <defs><marker id="studydeck-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#0891b2" /></marker></defs>
    {edges.map((edge) => { const from = byId.get(edge.from); const to = byId.get(edge.to); if (!from || !to) return null; return <g key={edge.id}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#67e8f9" strokeWidth="0.7" markerEnd="url(#studydeck-arrow)" /><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 2} fontSize="2.5" fill="#64748b" textAnchor="middle">{edge.label}</text></g>; })}
    {nodes.map((node) => <g key={node.id}><rect x={node.x - 10} y={node.y - 6} width="20" height="12" rx="2" fill={node.tone === "accent" ? "#cffafe" : node.tone === "warning" ? "#fef3c7" : "#f8fafc"} stroke={node.tone === "accent" ? "#0891b2" : "#cbd5e1"} strokeWidth="0.6" /><text x={node.x} y={node.y - (node.value ? 1 : 0)} fontSize="2.5" fill="#0f172a" textAnchor="middle">{node.label.slice(0, 30)}</text>{node.value ? <text x={node.x} y={node.y + 3} fontSize="2.2" fill="#475569" textAnchor="middle">{node.value.slice(0, 24)}</text> : null}</g>)}
  </svg>;
}

function PlotView({ visual }: { visual: PlotlyVisualSpec }) {
  const max = Math.max(1, ...visual.series.flatMap((series) => series.values.map((value) => Math.abs(value))));
  const width = 100 / Math.max(1, visual.x.length);
  return <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={`${visual.chartType} chart`}><line x1="8" y1="92" x2="96" y2="92" stroke="#94a3b8" /><line x1="8" y1="8" x2="8" y2="92" stroke="#94a3b8" />{visual.series.map((series, seriesIndex) => series.values.map((value, index) => { const x = 12 + index * (88 / Math.max(1, visual.x.length - 1)); const y = 88 - (value / max) * 70; if (visual.chartType === "bar") return <rect key={`${series.name}-${index}`} x={8 + index * width + seriesIndex * Math.min(7, width / Math.max(1, visual.series.length))} y={y} width={Math.max(2, width / Math.max(1, visual.series.length + 1))} height={92 - y} fill={series.color ?? (seriesIndex ? "#06b6d4" : "#2563eb")} opacity="0.85" />; return index === 0 ? null : <line key={`${series.name}-${index}`} x1={12 + (index - 1) * (88 / Math.max(1, visual.x.length - 1))} y1={88 - (series.values[index - 1] / max) * 70} x2={x} y2={y} stroke={series.color ?? (seriesIndex ? "#06b6d4" : "#2563eb")} strokeWidth="1.3" />; }))}</svg>;
}

function GraphView({ visual }: { visual: JSXGraphVisualSpec }) {
  const points = visual.objects.filter((object) => object.type === "point");
  return <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label="Interactive geometry preview"><line x1="8" y1="50" x2="94" y2="50" stroke="#cbd5e1" /><line x1="50" y1="8" x2="50" y2="94" stroke="#cbd5e1" />{points.map((point) => { if (point.type !== "point") return null; const x = 50 + point.x * 12; const y = 50 - point.y * 12; return <g key={point.id}><circle cx={x} cy={y} r="2.2" fill="#2563eb" /><text x={x + 3} y={y - 3} fontSize="3" fill="#334155">{point.label ?? point.id}</text></g>; })}<text x="50" y="98" fontSize="3" fill="#64748b" textAnchor="middle">Double-click to interact with this geometry</text></svg>;
}
