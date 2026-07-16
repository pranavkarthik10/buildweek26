import { describe, expect, it } from "vitest";

import { randomUUID } from "node:crypto";

import { getOrCreateModelOutput, modelOutputCacheKey, stableStringify } from "@/lib/model-output-cache";

describe("model output cache", () => {
  it("hashes equivalent objects identically regardless of property order", () => {
    expect(modelOutputCacheKey("lecture-v1", { b: 2, a: { y: 2, x: 1 } }))
      .toBe(modelOutputCacheKey("lecture-v1", { a: { x: 1, y: 2 }, b: 2 }));
  });

  it("changes keys when a model, voice, prompt version, or input changes", () => {
    const base = { model: "one", voice: "Charon", promptVersion: 1, text: "hello" };
    expect(modelOutputCacheKey("tts", base)).not.toBe(modelOutputCacheKey("tts", { ...base, model: "two" }));
    expect(modelOutputCacheKey("tts", base)).not.toBe(modelOutputCacheKey("tts", { ...base, voice: "Kore" }));
    expect(modelOutputCacheKey("tts", base)).not.toBe(modelOutputCacheKey("tts", { ...base, text: "goodbye" }));
  });

  it("serializes arrays in order and object properties canonically", () => {
    expect(stableStringify({ z: [2, 1], a: true })).toBe('{"a":true,"z":[2,1]}');
  });

  it("reuses a persisted result without invoking the producer twice", async () => {
    const namespace = `cache-test-${randomUUID()}`;
    const key = modelOutputCacheKey(namespace, { input: "same" });
    let calls = 0;
    const load = () => getOrCreateModelOutput({
      namespace,
      key,
      validate: (value): value is { answer: number } => Boolean(value)
        && typeof value === "object"
        && (value as { answer?: unknown }).answer === 42,
      create: async () => {
        calls += 1;
        return { answer: 42 };
      },
    });
    expect((await load()).cacheHit).toBe(false);
    expect((await load()).cacheHit).toBe(true);
    expect(calls).toBe(1);
  });
});
