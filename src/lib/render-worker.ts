import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";
import { compileManimScene } from "@/lib/manim-compiler";
import { synthesizeLectureSpeech } from "@/lib/speech";
import { validateVisualSpec } from "@/lib/visual-spec";
import type { ManimVisualSpec, VisualExplainerSpec } from "@/lib/explainer-types";
import { jobKeyForSpec } from "@/lib/explainer";
import { isObjectStorageConfigured, objectUrlForKey, putObject } from "@/lib/object-storage";

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 180_000;

export type RenderResult = {
  artifactUrl: string;
  audioUrl?: string;
  durationSec: number;
  renderer: "manim";
};

export async function renderExplainerArtifact({ spec }: { artifactId: string; spec: VisualExplainerSpec }): Promise<RenderResult> {
  if (spec.engine !== "manim" || spec.kind !== "video") throw new Error("Only validated Manim specs can be rendered.");
  const jobKey = jobKeyForSpec(spec);
  const scratchRoot = process.env.RENDER_SCRATCH_DIR?.trim() || path.join(os.tmpdir(), "studydeck-render");
  await fs.mkdir(scratchRoot, { recursive: true });
  const jobDir = await fs.mkdtemp(path.join(scratchRoot, `${jobKey}-`));
  const keepScratch = process.env.RENDER_DEBUG === "true";

  try {
    await fs.writeFile(path.join(jobDir, "scene.py"), compileManimScene(spec.visual as ManimVisualSpec), "utf8");
    await runManim(jobDir);
    const renderedPath = await findMp4(jobDir);
    const durationSec = await verifyVideo(renderedPath, spec.durationSec);
    const audio = await writeNarrationAudio(jobDir, spec);
    const captionsPath = await writeCaptionFile(jobDir, spec);
    const finalPath = audio ? path.join(jobDir, "final.mp4") : renderedPath;
    if (audio) await muxAudio(renderedPath, audio.path, finalPath, spec.durationSec, captionsPath);
    const artifactUrl = await publishFile(finalPath, `artifacts/${jobKey}.mp4`, "video/mp4");
    const audioUrl = audio ? await publishFile(audio.path, `artifacts/${jobKey}.audio${audio.extension}`, audio.mimeType) : undefined;
    return { artifactUrl, audioUrl, durationSec, renderer: "manim" };
  } finally {
    if (!keepScratch) await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function renderExplainerArtifactById(artifactId: string) {
  const artifact = await prisma.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact) throw new Error("Render artifact not found.");
  let spec: VisualExplainerSpec;
  try {
    spec = validateVisualSpec(JSON.parse(artifact.spec));
  } catch {
    await prisma.artifact.update({ where: { id: artifactId }, data: { status: "failed", error: "The persisted visual spec is invalid." } });
    return;
  }
  const claimed = await prisma.artifact.updateMany({ where: { id: artifactId, status: { in: ["preview", "queued", "failed"] } }, data: { status: "processing", error: null } });
  if (claimed.count === 0) return;
  try {
    const result = await renderExplainerArtifact({ artifactId, spec });
    await prisma.artifact.update({
      where: { id: artifactId },
      data: { status: "completed", artifactUrl: result.artifactUrl, audioUrl: result.audioUrl, captions: JSON.stringify(spec.captions), error: null },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manim rendering failed.";
    await prisma.artifact.update({ where: { id: artifactId }, data: { status: "failed", error: message.slice(0, 4_000) } });
    throw error;
  }
}

async function runManim(jobDir: string) {
  const args = [
    "run", "--rm", "--network", "none", "--read-only", "--security-opt", "no-new-privileges",
    "--cpus", process.env.RENDER_CPU_LIMIT ?? "2", "--memory", process.env.RENDER_MEMORY_LIMIT ?? "2g",
    "--pids-limit", "128", "--tmpfs", "/tmp:rw,size=256m", "-v", `${path.resolve(jobDir)}:/work:rw`,
    "-w", "/work", process.env.MANIM_IMAGE ?? "manimcommunity/manim:v0.20.1", "manim", "render",
    "--renderer", "cairo", "--format", "mp4", "--fps", "30", "-q", "m", "--media_dir", "/work/media",
    "-o", "explainer", "/work/scene.py", "StudydeckScene",
  ];
  try {
    await execFile("docker", args, { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 2_000_000, windowsHide: true });
  } catch (error) {
    const cause = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error(`Manim worker failed: ${[cause.message, cause.stderr, cause.stdout].filter(Boolean).join("\n").slice(-4_000)}`);
  }
}

async function findMp4(root: string): Promise<string> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp4")) return full;
    if (entry.isDirectory()) {
      const nested = await findMp4(full).catch(() => null);
      if (nested) return nested;
    }
  }
  throw new Error("Manim did not produce an MP4 artifact.");
}

async function writeNarrationAudio(jobDir: string, spec: VisualExplainerSpec) {
  const narration = spec.captions.map((caption) => caption.text).join(" ").trim();
  if (!narration) return null;
  try {
    const speech = await synthesizeLectureSpeech({ text: narration, cache: true });
    const extension = speech.mimeType.includes("mpeg") ? ".mp3" : ".wav";
    const audioPath = path.join(jobDir, `narration${extension}`);
    const bytes = Buffer.from(speech.audio, "base64");
    if (extension === ".wav" && speech.mimeType.includes("pcm")) {
      await fs.writeFile(audioPath, pcmToWav(bytes, speech.sampleRate || 24_000));
    } else {
      await fs.writeFile(audioPath, bytes);
    }
    return { path: audioPath, extension, mimeType: extension === ".mp3" ? "audio/mpeg" : "audio/wav" };
  } catch {
    // A video remains useful when TTS is unavailable; captions stay embedded in the artifact metadata.
    return null;
  }
}

async function muxAudio(videoPath: string, audioPath: string, outputPath: string, durationSec: number, captionsPath?: string) {
  const base = ["-y", "-i", videoPath, "-i", audioPath, "-t", String(durationSec), "-c:a", "aac", "-shortest"];
  try {
    const captionFilter = captionsPath ? `subtitles=${captionsPath.replaceAll("\\", "/").replaceAll(":", "\\:")}` : undefined;
    await execFile("ffmpeg", [...base, ...(captionFilter ? ["-vf", captionFilter, "-c:v", "libx264"] : ["-c:v", "copy"]), outputPath], { timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true });
  } catch (error) {
    if (!captionsPath) throw error;
    await execFile("ffmpeg", [...base, "-c:v", "copy", outputPath], { timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true });
  }
}

async function writeCaptionFile(jobDir: string, spec: VisualExplainerSpec) {
  const srt = spec.captions.map((beat, index) => `${index + 1}\n${formatSrtTime(beat.startSec)} --> ${formatSrtTime(beat.startSec + beat.durationSec)}\n${beat.text}\n`).join("\n");
  const filename = path.join(jobDir, "captions.srt");
  await fs.writeFile(filename, srt, "utf8");
  return filename;
}

function formatSrtTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const whole = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function pcmToWav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function verifyVideo(outputPath: string, expectedDurationSec: number) {
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 1_024) throw new Error("Manim produced an empty video artifact.");
  try {
    const result = await execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath], { timeout: 20_000, maxBuffer: 16_000, windowsHide: true });
    const duration = Number.parseFloat(result.stdout.trim());
    if (!Number.isFinite(duration) || Math.abs(duration - expectedDurationSec) > 3) throw new Error(`Rendered video duration ${duration.toFixed(2)}s does not match ${expectedDurationSec}s.`);
    return duration;
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) throw error;
    return expectedDurationSec;
  }
}

async function publishFile(filePath: string, key: string, contentType: string) {
  if (isObjectStorageConfigured()) {
    await putObject({ key, body: await fs.readFile(filePath), contentType });
    const url = objectUrlForKey(key);
    if (!url) throw new Error("Object storage URL is unavailable.");
    return url;
  }
  const publicDir = path.join(process.cwd(), "public", "generated-artifacts");
  await fs.mkdir(publicDir, { recursive: true });
  const destination = path.join(publicDir, path.basename(key));
  await fs.copyFile(filePath, destination);
  return `/generated-artifacts/${path.basename(key)}`;
}
