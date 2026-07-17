"use client";

import {
  AudioLines,
  CircleAlert,
  LoaderCircle,
  Mic,
  MicOff,
  Play,
  Radio,
  Square,
} from "lucide-react";

export type RealtimePerformanceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

export type RealtimePerformanceControlsProps = {
  state: RealtimePerformanceState;
  microphoneMuted: boolean;
  currentBeat: number;
  totalBeats: number;
  transcript?: string;
  errorMessage?: string;
  onConnect: () => void;
  onPlay: () => void;
  onInterrupt: () => void;
  onToggleMute: () => void;
};

const STATE_COPY: Record<RealtimePerformanceState, { label: string; detail: string }> = {
  idle: { label: "Ready", detail: "Connect voice, then ask a question aloud." },
  connecting: { label: "Connecting", detail: "Starting voice…" },
  listening: { label: "Listening", detail: "Your microphone is live. Ask a question or interrupt." },
  thinking: { label: "Thinking", detail: "Choosing the clearest way to show the answer." },
  speaking: { label: "Speaking", detail: "Each mark is being cued immediately before the tutor explains it." },
  interrupted: { label: "Interrupted", detail: "The remaining ink beats were stopped with the voice." },
  error: { label: "Voice unavailable", detail: "Check microphone permission, then reconnect." },
};

export function RealtimePerformanceControls({
  state,
  microphoneMuted,
  currentBeat,
  totalBeats,
  transcript,
  errorMessage,
  onConnect,
  onPlay,
  onInterrupt,
  onToggleMute,
}: RealtimePerformanceControlsProps) {
  const isConnecting = state === "connecting";
  const isLive = state === "listening" || state === "thinking" || state === "speaking";
  const isSpeaking = state === "speaking";
  const stateCopy = STATE_COPY[state];
  const completedBeats = Math.min(Math.max(currentBeat, 0), Math.max(totalBeats, 0));
  const progress = totalBeats > 0 ? (completedBeats / totalBeats) * 100 : 0;

  return (
    <section
      aria-label="Voice and drawing controls"
      className="rounded-xl border border-white/10 bg-[#101611] p-3 shadow-[0_10px_32px_rgba(0,0,0,0.18)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${isSpeaking ? "bg-[#c6ff67] text-[#162010]" : "bg-white/[0.07] text-[#cbd7c6]"}`}>
            {isConnecting || state === "thinking" ? <LoaderCircle className="size-4 animate-spin" /> : isSpeaking ? <AudioLines className="size-4" /> : <Radio className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#a8b6a3]">LIVE PERFORMANCE</p>
            <p className="mt-0.5 text-sm font-medium text-white">{stateCopy.label}</p>
          </div>
        </div>
        <span className={`mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${isLive ? "text-[#c6ff67]" : "text-[#a8b6a3]"}`}>
          <span className={`size-1.5 rounded-full ${isLive ? "bg-[#c6ff67] shadow-[0_0_0_4px_rgba(198,255,103,0.12)]" : "bg-[#6f7b6b]"}`} />
          {isLive ? "live" : "standby"}
        </span>
      </div>

      <p className="mt-3 text-xs leading-5 text-[#b9c5b5]" aria-live="polite">{stateCopy.detail}</p>
      {state === "error" ? (
        <div role="alert" className="mt-2 flex gap-2 rounded-lg border border-[#ff9a86]/25 bg-[#ff9a86]/[0.08] px-2.5 py-2 text-xs leading-5 text-[#ffd2c8]">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{errorMessage ?? "Microphone access or the voice session could not be started."}</span>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={microphoneMuted}
          aria-label={microphoneMuted ? "Enable microphone" : "Mute microphone"}
          className={`grid size-9 place-items-center rounded-lg border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6ff67] ${microphoneMuted ? "border-[#ff9a86]/45 bg-[#ff9a86]/10 text-[#ffb8a9]" : "border-white/12 bg-white/[0.04] text-[#dfe9da] hover:bg-white/[0.09]"}`}
        >
          {microphoneMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        {isLive ? (
          <button type="button" onClick={onInterrupt} className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#ff9a86]/45 bg-[#ff9a86]/10 px-3 text-xs font-semibold text-[#ffc1b4] transition hover:bg-[#ff9a86]/18 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6ff67]">
            <Square className="size-3 fill-current" /> Stop
          </button>
        ) : state === "idle" || state === "error" || state === "interrupted" ? (
          <button type="button" onClick={state === "idle" ? onConnect : onPlay} className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#c6ff67] px-3 text-xs font-semibold text-[#172011] transition hover:bg-[#dcffa0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6ff67]">
            {state === "idle" ? <Radio className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
            {state === "idle" ? "Connect voice" : "Resume"}
          </button>
        ) : (
          <button type="button" onClick={onPlay} disabled={isConnecting} className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#c6ff67]/40 bg-[#c6ff67]/10 px-3 text-xs font-semibold text-[#dfffb2] transition hover:bg-[#c6ff67]/18 disabled:cursor-wait disabled:opacity-65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6ff67]">
            {isConnecting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
            Play ink
          </button>
        )}
      </div>

      <div className="mt-3" aria-label={`${completedBeats} of ${totalBeats} ink beats complete`}>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#97a493]">
          <span>DRAWING</span>
          <span className="font-mono text-[#d9e4d5]">{completedBeats}/{totalBeats || "—"}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-[#c6ff67] transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {transcript ? (
        <div className="mt-3 border-l-2 border-[#c6ff67]/70 pl-2.5">
          <p className="line-clamp-2 text-xs leading-5 text-[#d9e4d5]">{transcript}</p>
        </div>
      ) : null}
      {microphoneMuted && isLive ? <p className="mt-2 text-[11px] text-[#f5d771]">Microphone muted — you can still hear the tutor.</p> : null}
    </section>
  );
}
