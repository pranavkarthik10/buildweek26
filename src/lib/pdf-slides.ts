import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RenderedSlide = {
  id: string;
  slideNumber: number;
  imageUrl: string;
};

export async function renderPdfSlides(input: File | Buffer): Promise<{
  deckId: string;
  slides: RenderedSlide[];
}> {
  const deckId = randomUUID();
  const tempDir = path.join("/tmp", `aiprof-${deckId}`);
  const publicDir = path.join(process.cwd(), "public", "generated-decks", deckId);
  const pdfPath = path.join(tempDir, "deck.pdf");
  const outputPrefix = path.join(publicDir, "slide");

  await mkdir(tempDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  try {
    const buffer = Buffer.isBuffer(input)
      ? input
      : Buffer.from(await input.arrayBuffer());
    await writeFile(pdfPath, buffer);

    await execFileAsync("pdftoppm", ["-png", "-r", "144", pdfPath, outputPrefix], {
      maxBuffer: 1024 * 1024 * 16,
    });

    const files = (await readdir(publicDir))
      .filter((name) => /^slide-\d+\.png$/.test(name))
      .sort((a, b) => slideNumberFromFile(a) - slideNumberFromFile(b));

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
  }
}

function slideNumberFromFile(fileName: string) {
  const match = fileName.match(/slide-(\d+)\.png$/);
  return match ? Number(match[1]) : 0;
}
