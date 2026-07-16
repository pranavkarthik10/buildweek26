export class PcmAudioPlayer {
  private context: AudioContext | null = null;
  private nextStartTime = 0;
  private scheduleReady = Promise.resolve();
  private sources = new Set<AudioBufferSourceNode>();
  private playbackRate = 1;
  private paused = false;
  private muted = false;

  async unlock() {
    const context = await this.getContext();
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
  }

  async play(
    base64Audio: string,
    sampleRate = 24000,
    playbackRate = 1,
    mimeType = "audio/pcm",
  ) {
    if (this.muted) {
      return Promise.resolve();
    }

    this.setPlaybackRate(playbackRate);
    return this.queue(base64Audio, sampleRate, playbackRate, mimeType);
  }

  queue(
    base64Audio: string,
    sampleRate = 24000,
    playbackRate = this.playbackRate,
    mimeType = "audio/pcm",
  ) {
    if (this.muted) {
      return Promise.resolve();
    }

    this.setPlaybackRate(playbackRate);
    let playbackDone = Promise.resolve();
    const scheduled = this.scheduleReady.then(async () => {
      const context = await this.getContext();
      playbackDone = isPcmAudioMimeType(mimeType)
        ? this.schedulePcmSource(
            context,
            base64Audio,
            sampleRate,
            this.playbackRate,
          )
        : this.scheduleEncodedSource(context, base64Audio, this.playbackRate);
    });

    this.scheduleReady = scheduled.catch(() => undefined);

    return scheduled.then(() => playbackDone);
  }

  setPlaybackRate(playbackRate: number) {
    this.playbackRate = Math.min(2, Math.max(0.7, playbackRate));

    for (const source of this.sources) {
      source.playbackRate.setTargetAtTime(
        this.playbackRate,
        source.context.currentTime,
        0.02,
      );
    }
  }

  async pause() {
    this.paused = true;

    if (this.context?.state === "running") {
      await this.context.suspend();
    }
  }

  async resume() {
    this.paused = false;

    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  private schedulePcmSource(
    context: AudioContext,
    base64Pcm: string,
    sampleRate = 24000,
    playbackRate = 1,
  ) {
    const bytes = base64ToUint8Array(base64Pcm);

    if (bytes.byteLength === 0) {
      throw new Error("Received an empty PCM audio chunk.");
    }

    if (bytes.byteLength % 2 !== 0) {
      throw new Error("Received an invalid 16-bit PCM audio chunk.");
    }

    const samples = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 2,
    );
    const audioBuffer = context.createBuffer(1, samples.length, sampleRate);
    const channel = audioBuffer.getChannelData(0);

    for (let i = 0; i < samples.length; i += 1) {
      channel[i] = samples[i] / 32768;
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;
    source.connect(context.destination);

    const startTime = Math.max(context.currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration / playbackRate;
    this.sources.add(source);

    return new Promise<void>((resolve) => {
      source.onended = () => {
        this.sources.delete(source);
        resolve();
      };
    });
  }

  private async scheduleEncodedSource(
    context: AudioContext,
    base64Audio: string,
    playbackRate = 1,
  ) {
    const bytes = base64ToUint8Array(base64Audio);
    const audioBuffer = await context.decodeAudioData(bytes.buffer.slice(0));
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = playbackRate;
    source.connect(context.destination);

    const startTime = Math.max(context.currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration / playbackRate;
    this.sources.add(source);

    return new Promise<void>((resolve) => {
      source.onended = () => {
        this.sources.delete(source);
        resolve();
      };
    });
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Source may already have ended.
      }
    }

    this.sources.clear();

    if (this.context) {
      this.nextStartTime = this.context.currentTime;
    }

    this.scheduleReady = Promise.resolve();
    this.paused = false;
  }

  setMuted(muted: boolean) {
    this.muted = muted;

    if (muted) {
      this.stop();
    }
  }

  async close() {
    this.stop();

    if (this.context) {
      await this.context.close();
      this.context = null;
      this.nextStartTime = 0;
    }
  }

  private async getContext() {
    this.context ??= new AudioContext({ sampleRate: 24000 });

    if (this.context.state === "suspended" && !this.paused) {
      await this.context.resume();
    }

    return this.context;
  }
}

/**
 * Gemini TTS returns raw signed 16-bit PCM as `audio/l16`, while other audio
 * paths use the equivalent `audio/pcm` label. Neither is a browser audio
 * container, so both must be scheduled directly instead of passed to
 * `decodeAudioData`.
 */
export function isPcmAudioMimeType(mimeType?: string) {
  const mediaType = mimeType?.split(";", 1)[0]?.trim().toLowerCase();

  return (
    mediaType === "audio/pcm" ||
    mediaType === "audio/l16" ||
    mediaType === "audio/raw" ||
    mediaType === "audio/x-raw"
  );
}

function base64ToUint8Array(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
