import { getGeneralModel, getGeminiClient } from "@/lib/gemini";
import { buildExplainerSpec } from "@/lib/explainer";
import type { ExplainerRequestInput, VisualExplainerSpec } from "@/lib/explainer-types";
import { validateVisualSpec } from "@/lib/visual-spec";

/** Ask Gemini for visual primitives, then validate them against the application-owned union. */
export async function planVisualSpec(input: ExplainerRequestInput): Promise<VisualExplainerSpec> {
  const fallback = buildExplainerSpec(input);
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) return fallback;

  try {
    const response = await getGeminiClient().models.generateContent({
      model: getGeneralModel(),
      contents: [{ role: "user", parts: [{ text: [
        "Design a short educational visual for studydeck. Return JSON only.",
        "Do not return HTML, JavaScript, Python, URLs, or executable expressions.",
        `The application selected engine ${fallback.engine}. Keep that engine and use only its allowlisted primitives.`,
        `Question: ${input.question}`,
        `Concept: ${input.concept}`,
        `Goal: ${input.goal}`,
        `Slide context: ${input.slide?.title ?? "none"} — ${input.slide?.summary ?? "none"}`,
        "Return an object with visual and captions. visual must be a diagram, jsxgraph, plotly, or manim object matching the selected engine. Keep arrays small and values bounded.",
      ].join("\n") }] }],
      config: { temperature: 0.2, maxOutputTokens: 4500, responseMimeType: "application/json" },
    });
    const raw = parseJson(response.text ?? "");
    const generatedVisual = typeof raw.visual === "string" ? parseJson(raw.visual).visual ?? parseJson(raw.visual) : raw.visual;
    const candidate = { ...fallback, visual: generatedVisual ?? fallback.visual, captions: Array.isArray(raw.captions) ? raw.captions : fallback.captions };
    const validated = validateVisualSpec(candidate);
    return isUsefulVisual(validated) ? validated : fallback;
  } catch (error) {
    console.warn("[studydeck] visual planner fallback", error instanceof Error ? error.message : error);
    return fallback;
  }
}

function isUsefulVisual(spec: VisualExplainerSpec) {
  const visual = spec.visual;
  switch (visual.engine) {
    case "diagram": return visual.nodes.length >= 2 && visual.edges.length >= 1 && visual.steps.every((step) => step.narration.trim().length >= 8);
    case "plotly": return visual.x.length >= 2 && visual.series.some((series) => series.values.length === visual.x.length);
    case "jsxgraph": return visual.objects.length >= 1;
    case "manim": return visual.objects.length >= 1 && visual.actions.length >= 1;
  }
}

function parseJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const value: unknown = JSON.parse(trimmed);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
