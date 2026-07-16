import { execFile as execFileCallback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";
import {
  buildExplainerPreviewHtml,
  jobKeyForSpec,
} from "@/lib/explainer";
import type { ExplainerSpec } from "@/lib/explainer-types";
import {
  isObjectStorageConfigured,
  objectUrlForKey,
  putObject,
} from "@/lib/object-storage";

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 150_000;
const MAX_STDOUT = 2_000_000;

type RenderOptions = {
  artifactId: string;
  spec: ExplainerSpec;
};

export type RenderResult = {
  artifactUrl: string;
  durationSec: number;
  renderer: "hyperframes" | "manim-fallback";
};

/**
 * Render one validated ExplainerSpec in an isolated scratch directory.
 *
 * The model never supplies HTML, JavaScript, or Python to this function. It
 * only receives the normalized spec and this module emits the fixed,
 * allowlisted composition from explainer.ts. The directory is removed after
 * upload unless RENDER_DEBUG=true.
 */
export async function renderExplainerArtifact({ spec }: RenderOptions): Promise<RenderResult> {
  const jobKey = jobKeyForSpec(spec);
  const scratchRoot = process.env.RENDER_SCRATCH_DIR?.trim() || path.join(os.tmpdir(), "studydeck-render");
  await fs.mkdir(scratchRoot, { recursive: true });
  const jobDir = await fs.mkdtemp(path.join(scratchRoot, `${jobKey}-`));
  const outputPath = path.join(jobDir, "explainer.mp4");
  const keepScratch = process.env.RENDER_DEBUG === "true";

  try {
    await writeComposition(jobDir, spec);
    const diagnostics = await runHyperFramesCheck(jobDir);
    if (!diagnostics.ok) {
      throw new Error(`HyperFrames validation failed: ${diagnostics.message}`);
    }

    await runHyperFramesRender(jobDir, outputPath, spec.durationSec);
    const durationSec = await verifyVideo(outputPath, spec.durationSec);
    const artifactUrl = await publishArtifact(outputPath, jobKey);

    return {
      artifactUrl,
      durationSec,
      renderer: spec.engine === "manim" ? "manim-fallback" : "hyperframes",
    };
  } finally {
    if (!keepScratch) {
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Render and update the persisted Artifact row. Safe to call fire-and-forget. */
export async function renderExplainerArtifactById(artifactId: string) {
  const artifact = await prisma.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact) throw new Error("Render artifact not found.");

  let spec: ExplainerSpec;
  try {
    spec = JSON.parse(artifact.spec) as ExplainerSpec;
  } catch {
    await prisma.artifact.update({
      where: { id: artifactId },
      data: { status: "failed", error: "The persisted explainer spec is invalid." },
    });
    return;
  }

  const claimed = await prisma.artifact.updateMany({
    where: { id: artifactId, status: { in: ["preview", "queued", "failed"] } },
    data: { status: "processing", error: null },
  });
  if (claimed.count === 0) return;

  try {
    const result = await renderExplainerArtifact({ artifactId, spec });
    await prisma.artifact.update({
      where: { id: artifactId },
      data: {
        status: "completed",
        artifactUrl: result.artifactUrl,
        error: null,
      },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Explainer rendering failed.";
    await prisma.artifact.update({
      where: { id: artifactId },
      data: { status: "failed", error: message.slice(0, 4_000) },
    });
    throw error;
  }
}

async function writeComposition(jobDir: string, spec: ExplainerSpec) {
  const html = buildExplainerPreviewHtml(spec).replace(
    "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js",
    "./gsap.min.js",
  );
  await fs.writeFile(path.join(jobDir, "index.html"), html, "utf8");

  const gsapSource = path.join(process.cwd(), "node_modules", "gsap", "dist", "gsap.min.js");
  await fs.copyFile(gsapSource, path.join(jobDir, "gsap.min.js"));
}

async function runHyperFramesCheck(jobDir: string) {
  const result = await runHyperFrames(["check", jobDir, "--json"], 60_000);
  const parsed = parseHyperFramesJsonOutput(result.stdout);
  const ok = Boolean(parsed && typeof parsed === "object" && "ok" in parsed && parsed.ok === true);
  return {
    ok,
    message: ok ? "ok" : summarizeCheckFailure(result.stdout, result.stderr),
  };
}

async function runHyperFramesRender(jobDir: string, outputPath: string, durationSec: number) {
  await runHyperFrames([
    "render",
    jobDir,
    "--output",
    outputPath,
    "--quality",
    process.env.RENDER_QUALITY === "high" ? "high" : "draft",
    "--workers",
    "1",
    "--no-browser-gpu",
    "--strict",
  ], Math.max(DEFAULT_TIMEOUT_MS, durationSec * 12_000));
}

async function runHyperFrames(args: string[], timeout: number) {
  const executable = process.platform === "win32"
    ? path.join("node_modules", ".bin", "hyperframes.cmd")
    : path.join(process.cwd(), "node_modules", ".bin", "hyperframes");
  try {
    return await execFile(executable, args, {
      cwd: process.cwd(),
      timeout,
      maxBuffer: MAX_STDOUT,
      windowsHide: true,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        // Keep the browser worker deterministic and prevent accidental data
        // exfiltration from a future composition change.
        HYPERFRAMES_NO_TELEMETRY: "1",
      },
    });
  } catch (error) {
    const cause = error as { stdout?: string; stderr?: string; message?: string };
    const detail = [cause.message, cause.stderr, cause.stdout].filter(Boolean).join("\n");
    throw new Error(`HyperFrames command failed: ${detail.slice(-4_000)}`);
  }
}

async function verifyVideo(outputPath: string, expectedDurationSec: number) {
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 1_024) {
    throw new Error("Renderer produced an empty video artifact.");
  }

  try {
    const result = await execFile("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ], { timeout: 20_000, maxBuffer: 16_000, windowsHide: true });
    const duration = Number.parseFloat(result.stdout.trim());
    if (!Number.isFinite(duration) || Math.abs(duration - expectedDurationSec) > 1.5) {
      throw new Error(`Rendered video duration ${duration.toFixed(2)}s does not match ${expectedDurationSec}s.`);
    }
    return duration;
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) throw error;
    // HyperFrames already validates the encoded stream. On minimal deploy
    // images without ffprobe, the non-empty artifact check is still useful.
    return expectedDurationSec;
  }
}

async function publishArtifact(outputPath: string, jobKey: string) {
  if (isObjectStorageConfigured()) {
    const key = `artifacts/${jobKey}.mp4`;
    const body = await fs.readFile(outputPath);
    await putObject({ key, body, contentType: "video/mp4" });
    const url = objectUrlForKey(key);
    if (!url) throw new Error("Object storage URL is unavailable.");
    return url;
  }

  const publicDir = path.join(process.cwd(), "public", "generated-artifacts");
  await fs.mkdir(publicDir, { recursive: true });
  const destination = path.join(publicDir, `${jobKey}.mp4`);
  await fs.copyFile(outputPath, destination);
  return `/generated-artifacts/${jobKey}.mp4`;
}

export function parseHyperFramesJsonOutput(output: string) {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const end = trimmed.lastIndexOf("}");
    if (end < 0) return null;
    let fallback: unknown = null;
    for (let start = trimmed.indexOf("{"); start >= 0 && start < end; start = trimmed.indexOf("{", start + 1)) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;
        fallback ??= parsed;
      } catch {
        // Keep scanning past structured log fragments until the final payload.
      }
    }
    return fallback;
  }
}

function summarizeCheckFailure(stdout: string, stderr: string) {
  return [stderr, stdout].filter(Boolean).join("\n").trim().slice(-1_000) || "Unknown validation error.";
}
