import { describe, expect, it } from "vitest";

import { isPcmAudioMimeType } from "@/lib/live-audio";

describe("isPcmAudioMimeType", () => {
  it.each([
    "audio/pcm",
    "audio/pcm;rate=24000",
    "audio/l16; rate=24000; channels=1",
    "audio/raw",
    "audio/x-raw;format=S16LE",
  ])("recognizes raw PCM MIME %s", (mimeType) => {
    expect(isPcmAudioMimeType(mimeType)).toBe(true);
  });

  it.each(["audio/mpeg", "audio/wav", "audio/ogg", undefined, ""]) (
    "does not treat %s as raw PCM",
    (mimeType) => {
      expect(isPcmAudioMimeType(mimeType)).toBe(false);
    },
  );
});
