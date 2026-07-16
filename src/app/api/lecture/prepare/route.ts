import { NextResponse } from "next/server";

import {
  getErrorMessage,
  getGeneralModel,
  uploadPdfAndBuildLecture,
} from "@/lib/gemini";
import {
  hashFile,
  moveRenderedDeckToCache,
  publishDeckAssetsToObjectStorage,
  readCachedDeck,
  writeCachedDeck,
} from "@/lib/lecture-cache";
import { MAX_PDF_BYTES, MAX_PDF_PAGES, renderPdfSlides } from "@/lib/pdf-slides";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF lecture decks are supported right now." },
        { status: 400 },
      );
    }

    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: `PDF uploads are limited to ${MAX_PDF_BYTES / 1_000_000} MB.` },
        { status: 413 },
      );
    }

    const { hash, buffer } = await hashFile(file);
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 400 });
    }
    const cachedDeck = await readCachedDeck(hash);

    if (cachedDeck) {
      const lectureDeck = cachedDeck.sourceUrl
        ? cachedDeck
        : await publishDeckAssetsToObjectStorage({
            deck: cachedDeck,
            sourcePdf: buffer,
          });

      if (lectureDeck !== cachedDeck) {
        await writeCachedDeck(hash, lectureDeck);
      }

      const debug = {
        route: "/api/lecture/prepare",
        model: getGeneralModel(),
        fileName: file.name,
        durationMs: Date.now() - startedAt,
        slides: lectureDeck.slides.length,
        cacheHit: true,
        ok: true,
      };

      console.log("[aiprof] prepare cache hit", debug);
      return NextResponse.json({ lectureDeck, debug });
    }

    const rendered = await renderPdfSlides(buffer);
    const uncachedDeck = await uploadPdfAndBuildLecture(
      file,
      rendered.slides,
      rendered.deckId,
    );
    const cachedLocalDeck = await moveRenderedDeckToCache(uncachedDeck, hash);
    const lectureDeck = await publishDeckAssetsToObjectStorage({
      deck: cachedLocalDeck,
      sourcePdf: buffer,
    });
    await writeCachedDeck(hash, lectureDeck);

    const debug = {
      route: "/api/lecture/prepare",
      model: getGeneralModel(),
      fileName: file.name,
      durationMs: Date.now() - startedAt,
      slides: Math.min(lectureDeck.slides.length, MAX_PDF_PAGES),
      cacheHit: false,
      ok: true,
    };

    console.log("[aiprof] prepare success", debug);

    return NextResponse.json({ lectureDeck, debug });
  } catch (error) {
    const message = getErrorMessage(error);
    const debug = {
      route: "/api/lecture/prepare",
      model: getGeneralModel(),
      durationMs: Date.now() - startedAt,
      ok: false,
      error: message,
    };

    console.error("[aiprof] prepare error", debug);

    return NextResponse.json({ error: message, debug }, { status: 500 });
  }
}
