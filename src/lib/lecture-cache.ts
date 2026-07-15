import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  readFile as readFileBuffer,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { LectureDeck } from "@/lib/aiprof-types";
import {
  isObjectStorageConfigured,
  objectUrlForKey,
  putObject,
} from "@/lib/object-storage";

const CACHE_DIR = path.join(process.cwd(), ".aiprof-cache");

export async function hashFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    hash: createHash("sha256").update(buffer).digest("hex"),
    buffer,
  };
}

export async function readCachedDeck(hash: string) {
  try {
    const data = await readFile(cachePath(hash), "utf8");
    return JSON.parse(data) as LectureDeck;
  } catch {
    return null;
  }
}

export async function writeCachedDeck(hash: string, deck: LectureDeck) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(hash), JSON.stringify(deck, null, 2));
}

export async function moveRenderedDeckToCache(deck: LectureDeck, hash: string) {
  const publicDeckRoot = path.join(process.cwd(), "public", "generated-decks");
  const currentDir = path.join(publicDeckRoot, deck.deckId);
  const cachedDir = path.join(publicDeckRoot, hash);

  if (deck.deckId !== hash) {
    await rename(currentDir, cachedDir);
  }

  return {
    ...deck,
    deckId: hash,
    slides: deck.slides.map((slide) => ({
      ...slide,
      imageUrl: slide.imageUrl.replace(`/generated-decks/${deck.deckId}/`, `/generated-decks/${hash}/`),
    })),
  };
}

export async function publishDeckAssetsToObjectStorage({
  deck,
  sourcePdf,
}: {
  deck: LectureDeck;
  sourcePdf: Buffer;
}) {
  if (!isObjectStorageConfigured()) return deck;

  const publicDeckRoot = path.join(process.cwd(), "public", "generated-decks");
  const deckDir = path.join(publicDeckRoot, deck.deckId);
  const sourceKey = `decks/${deck.deckId}/source.pdf`;

  await putObject({
    key: sourceKey,
    body: sourcePdf,
    contentType: "application/pdf",
  });

  const files = (await readdir(deckDir))
    .filter((name) => /^slide-\d+\.png$/.test(name))
    .sort();

  await Promise.all(
    files.map(async (name) => {
      const slideNumber = slideNumberFromFile(name);
      const key = `decks/${deck.deckId}/slides/${String(slideNumber).padStart(3, "0")}.png`;

      await putObject({
        key,
        body: await readFileBuffer(path.join(deckDir, name)),
        contentType: "image/png",
      });
    }),
  );

  const publishedDeck = {
    ...deck,
    sourceUrl: objectUrlForKey(sourceKey) ?? deck.sourceUrl,
    slides: deck.slides.map((slide) => {
      const key = `decks/${deck.deckId}/slides/${String(slide.slideNumber).padStart(3, "0")}.png`;
      const imageUrl = objectUrlForKey(key) ?? slide.imageUrl;

      return {
        ...slide,
        imageUrl,
      };
    }),
  };

  await putObject({
    key: `decks/${deck.deckId}/manifest.json`,
    body: Buffer.from(JSON.stringify(publishedDeck, null, 2)),
    contentType: "application/json",
  });

  return publishedDeck;
}

function cachePath(hash: string) {
  return path.join(CACHE_DIR, `${hash}.json`);
}

function slideNumberFromFile(fileName: string) {
  const match = fileName.match(/slide-(\d+)\.png$/);
  return match ? Number(match[1]) : 0;
}
