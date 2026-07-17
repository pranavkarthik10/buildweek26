import { describe, expect, it } from "vitest";

import {
  NotebookProbeVisionError,
  parseNotebookProbeVisionModelResponse,
  parseNotebookProbeVisionRequest,
} from "@/lib/notebook-probe-vision";

const imageDataUrl = "data:image/png;base64,AAAA";

describe("notebook probe vision validation", () => {
  it("accepts normalized gesture coordinates and a bounded image", () => {
    expect(parseNotebookProbeVisionRequest({
      imageDataUrl,
      gesture: { kind: "point", point: { x: 0.25, y: 0.75 } },
      question: "What is this?",
    })).toMatchObject({
      gesture: { point: { x: 0.25, y: 0.75 } },
      question: "What is this?",
    });
  });

  it("rejects a request without an intent", () => {
    expect(() => parseNotebookProbeVisionRequest({ imageDataUrl }))
      .toThrow(NotebookProbeVisionError);
  });

  it("rejects image types that cannot be sent to Gemini", () => {
    expect(() => parseNotebookProbeVisionRequest({
      imageDataUrl: "data:image/gif;base64,AAAA",
      question: "What is this?",
    })).toThrow("PNG, JPEG, or WebP");
  });

  it("accepts only in-bounds boxes and a returned focus id", () => {
    expect(parseNotebookProbeVisionModelResponse({
      regions: [{
        id: "region_1",
        label: "cell membrane",
        kind: "diagram",
        box: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
        confidence: 0.92,
      }],
      focusedRegionId: "region_1",
    }).focusedRegionId).toBe("region_1");
  });

  it("rejects boxes outside the normalized image", () => {
    expect(() => parseNotebookProbeVisionModelResponse({
      regions: [{
        id: "region_1",
        label: "outside",
        kind: "other",
        box: { x: 0.8, y: 0.1, width: 0.3, height: 0.2 },
        confidence: 0.7,
      }],
      focusedRegionId: "region_1",
    })).toThrow("invalid grounding result");
  });
});
