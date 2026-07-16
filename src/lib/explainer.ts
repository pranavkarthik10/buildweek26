import { createHash } from "node:crypto";

import type {
  ExplainerEngine,
  ExplainerRequestInput,
  ExplainerSpec,
  ExplainerStyle,
} from "@/lib/explainer-types";

export function normalizeExplainerInput(input: ExplainerRequestInput) {
  const duration = input.durationSec === 45 ? 45 : input.durationSec === 30 ? 30 : 15;
  const style: ExplainerStyle = ["clean", "chalk", "math", "diagram"].includes(input.visualStyle ?? "")
    ? (input.visualStyle as ExplainerStyle)
    : "clean";
  const question = input.question.trim().slice(0, 500);
  const concept = input.concept.trim().slice(0, 180);
  const goal = input.goal.trim().slice(0, 400);

  if (!question || !concept || !goal) {
    throw new Error("question, concept, and goal are required.");
  }

  return {
    ...input,
    question,
    concept,
    goal,
    durationSec: duration as 15 | 30 | 45,
    visualStyle: style,
  };
}

export function chooseExplainerEngine(input: Pick<ExplainerRequestInput, "question" | "concept" | "goal">): ExplainerEngine {
  const text = `${input.question} ${input.concept} ${input.goal}`.toLowerCase();
  return /derivative|integral|equation|proof|theorem|vector|matrix|geometry|triangle|calculus|limit|slope|chain rule|physics/.test(text)
    ? "manim"
    : "hyperframes";
}

export function buildExplainerSpec(raw: ExplainerRequestInput): ExplainerSpec {
  const input = normalizeExplainerInput(raw);
  const engine = chooseExplainerEngine(input);
  const beatDuration = input.durationSec / 3;
  const citation = input.slide
    ? [{ label: `Slide ${input.slide.slideNumber}: ${input.slide.title}`, slideNumber: input.slide.slideNumber }]
    : [];

  return {
    version: 1,
    engine,
    style: input.visualStyle,
    title: `Visualizing ${input.concept}`,
    question: input.question,
    concept: input.concept,
    goal: input.goal,
    durationSec: input.durationSec,
    aspectRatio: "16:9",
    beats: [
      {
        id: "orient",
        title: "The question",
        narration: `Let's make ${input.concept} visible before we manipulate it.`,
        visual: input.question,
        startSec: 0,
        durationSec: beatDuration,
      },
      {
        id: "build",
        title: "Build the idea",
        narration: input.goal,
        visual: input.slide?.summary ?? `A structured visual model of ${input.concept}.`,
        startSec: beatDuration,
        durationSec: beatDuration,
      },
      {
        id: "connect",
        title: "Connect it back",
        narration: `Now connect the picture back to the original question: ${input.question}`,
        visual: "Try the idea on a new example, then explain what changed.",
        startSec: beatDuration * 2,
        durationSec: beatDuration,
      },
    ],
    citations: citation,
  };
}

export function jobKeyForSpec(spec: ExplainerSpec) {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 48);
}

/**
 * Produce a HyperFrames-valid, deterministic composition. The HTML is also
 * useful as the instant preview shown while a sandboxed worker renders MP4.
 */
export function buildExplainerPreviewHtml(spec: ExplainerSpec) {
  const palette = spec.style === "chalk"
    ? { accent: "#f0b56b", secondary: "#a9e7d5", background: "#15211f" }
    : spec.style === "math"
      ? { accent: "#8bb8ff", secondary: "#c4a7ff", background: "#101827" }
      : spec.style === "diagram"
        ? { accent: "#59d4c6", secondary: "#ffc857", background: "#101b2c" }
        : { accent: "#75a9ff", secondary: "#b4a0ff", background: "#111827" };

  const beatMarkup = spec.beats.map((beat, index) => `
    <section id="studydeck-beat-${escapeHtml(beat.id)}" class="beat clip" data-start="${beat.startSec}" data-duration="${beat.durationSec}" data-track-index="1" style="--accent:${index % 2 ? palette.secondary : palette.accent};top:${390 + index * 170}px">
      <div class="beat-index">0${index + 1}</div>
      <div><h2>${escapeHtml(beat.title)}</h2><p>${escapeHtml(beat.visual)}</p></div>
    </section>`).join("");
  const captionMarkup = spec.beats.map((beat, index) => `
    <div id="studydeck-caption-${escapeHtml(beat.id)}" class="caption clip" data-start="${beat.startSec}" data-duration="${beat.durationSec}" data-track-index="2" style="--caption-accent:${index % 2 ? palette.secondary : palette.accent}">${escapeHtml(beat.narration)}</div>`).join("");
  const citationMarkup = spec.citations.length
    ? `<footer id="studydeck-citations">${spec.citations.map((citation) => escapeHtml(citation.label)).join(" · ")}</footer>`
    : "";
  const titleFontSize = spec.title.length > 72 ? 42 : spec.title.length > 48 ? 54 : 68;
  const timelineScript = spec.beats.map((beat) => `
      tl.fromTo("#studydeck-beat-${escapeJs(beat.id)}", { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.65, ease: "power2.out" }, ${beat.startSec});
      tl.fromTo("#studydeck-caption-${escapeJs(beat.id)}", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, ${beat.startSec});`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1920,height=1080"><title>${escapeHtml(spec.title)}</title>
<style>
  :root{color-scheme:dark;font-family:Arial,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}body{background:${palette.background};color:#f7f8fb}.composition{position:relative;width:1920px;height:1080px;padding:135px;overflow:hidden}.backdrop{position:absolute;inset:0;z-index:0;background:radial-gradient(circle at 82% 15%,${palette.accent}27,transparent 34%),linear-gradient(135deg,${palette.background},#0b1020)}.glow{position:absolute;z-index:1;width:800px;height:800px;right:-300px;bottom:-360px;border:1px solid ${palette.accent}55;border-radius:50%;box-shadow:0 0 90px ${palette.accent}33}.eyebrow{position:relative;z-index:2;font-size:25px;letter-spacing:.18em;text-transform:uppercase;color:${palette.accent};font-weight:700}.title{position:absolute;z-index:2;left:135px;right:135px;top:215px;width:1450px;height:145px;max-width:1450px;overflow:hidden;padding-top:5px;font-size:${titleFontSize}px;line-height:1.08;letter-spacing:-.04em;margin:0;opacity:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;word-break:break-word}.beat{position:absolute;z-index:2;left:135px;right:135px;width:1380px;height:126px;max-width:1380px;max-height:126px;display:flex;gap:24px;align-items:flex-start;overflow:hidden;margin:0;padding:16px 20px;border-left:3px solid var(--accent);background:linear-gradient(90deg,#ffffff0d,transparent);opacity:0}.beat-index{font-variant-numeric:tabular-nums;color:var(--accent);font-weight:800;font-size:18px}.beat h2{font-size:34px;line-height:1.05;margin:0 0 6px}.beat p{font-size:24px;line-height:1.25;color:#ced6e7;margin:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.caption{position:absolute;z-index:2;left:135px;right:135px;bottom:95px;height:116px;max-height:116px;overflow:hidden;padding:14px 22px;border-left:3px solid var(--caption-accent);background:#07101dcc;color:#f7f8fb;font-size:24px;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;opacity:0}footer{position:absolute;z-index:2;left:135px;bottom:35px;font-size:16px;color:#ffffff8c}
</style></head><body><main id="studydeck-explainer" class="composition" data-composition-id="studydeck-explainer" data-start="0" data-width="1920" data-height="1080" data-fps="30" data-duration="${spec.durationSec}"><div class="backdrop"></div><div class="glow" data-layout-allow-overflow="true"></div><div class="eyebrow">studydeck · ${escapeHtml(spec.engine)} visual</div><h1 id="studydeck-title" class="title clip" data-start="0" data-duration="${spec.durationSec}" data-track-index="0">${escapeHtml(spec.title)}</h1>${beatMarkup}${captionMarkup}${citationMarkup}</main><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.fromTo("#studydeck-title",{opacity:0,y:24},{opacity:1,y:0,duration:.7,ease:"power2.out"},.15);${timelineScript}window.__timelines["studydeck-explainer"]=tl;</script></body></html>`;
}

function escapeJs(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
