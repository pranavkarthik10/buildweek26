import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RenderedSlide = {
  id: string;
  slideNumber: number;
  imageUrl: string;
};

export const MAX_PDF_BYTES = 25_000_000;
export const MAX_PDF_PAGES = 100;

export async function renderPdfSlides(input: File | Buffer): Promise<{
  deckId: string;
  slides: RenderedSlide[];
}> {
  const deckId = randomUUID();
  const tempDir = path.join(tmpdir(), `studydeck-${deckId}`);
  const publicDir = path.join(process.cwd(), "public", "generated-decks", deckId);
  const pdfPath = path.join(tempDir, "deck.pdf");
  const outputPrefix = path.join(publicDir, "slide");

  await mkdir(tempDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });
  let completed = false;

  try {
    const buffer = Buffer.isBuffer(input)
      ? input
      : Buffer.from(await input.arrayBuffer());
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new Error(`PDF exceeds the ${MAX_PDF_BYTES / 1_000_000} MB upload limit.`);
    }
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("The uploaded file is not a valid PDF.");
    }
    await writeFile(pdfPath, buffer);

    const { stdout: pdfInfo } = await execFileAsync(resolvePopplerBinary("pdfinfo"), [pdfPath], {
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const pages = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    if (!Number.isSafeInteger(pages) || pages < 1) {
      throw new Error("The PDF does not contain readable pages.");
    }
    if (pages > MAX_PDF_PAGES) {
      throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit.`);
    }

    await execFileAsync(resolvePopplerBinary("pdftoppm"), ["-png", "-r", "144", "-f", "1", "-l", String(pages), pdfPath, outputPrefix], {
      maxBuffer: 1024 * 1024 * 16,
      windowsHide: true,
    });

    const files = (await readdir(publicDir))
      .filter((name) => /^slide-\d+\.png$/.test(name))
      .sort((a, b) => slideNumberFromFile(a) - slideNumberFromFile(b));

    completed = true;
    return {
      deckId,
      slides: files.map((name) => {
        const slideNumber = slideNumberFromFile(name);

        return {
          id: `slide-${String(slideNumber).padStart(3, "0")}`,
          slideNumber,
          imageUrl: `/generated-decks/${deckId}/${name}`,
        };
      }),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    if (!completed) await rm(publicDir, { recursive: true, force: true });
  }
}

function slideNumberFromFile(fileName: string) {
  const match = fileName.match(/slide-(\d+)\.png$/);
  return match ? Number(match[1]) : 0;
}

function resolvePopplerBinary(name: "pdfinfo" | "pdftoppm") {
  const configured = process.env[`${name.toUpperCase()}_PATH`]?.trim();
  if (configured) return configured;
  if (process.platform !== "win32") return name;

  const executable = `${name}.exe`;
  const shim = `${name}.cmd`;
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const direct = path.join(entry, executable);
    if (existsSync(direct)) return direct;
    const fromRuntimeOverride = path.resolve(entry, "..", "..", "native", "poppler", "Library", "bin", executable);
    if (existsSync(fromRuntimeOverride)) return fromRuntimeOverride;
    const fromNativeShim = path.resolve(entry, "..", "Library", "bin", executable);
    if (existsSync(fromNativeShim)) return fromNativeShim;
    const shimPath = path.join(entry, shim);
    if (existsSync(shimPath)) return shimPath;
  }
  return executable;
}
