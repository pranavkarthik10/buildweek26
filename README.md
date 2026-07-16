# studydeck — Build Week 2026

studydeck turns a PDF lecture deck into a structured lesson and interactive teaching session with narration, realtime Q&A, a persistent whiteboard, and visual explainers.

## Core flow

1. Open `/dashboard` (the root route redirects there).
2. Upload a PDF at `/deck/new`.
3. Let the AI prepare the deck, then choose a teaching style.
4. Run or resume the session at `/session/:id`.

## Stack

- Next.js 16 App Router
- TypeScript and Tailwind CSS v4
- Prisma 7 with SQLite for local development
- Gemini for document ingestion, structured lesson planning, TTS fallback, and explainer specs
- OpenAI `gpt-realtime-2.1-mini` for interruptible WebRTC tutoring and tool calls
- tldraw for the interactive whiteboard
- HyperFrames deterministic HTML/GSAP rendering, with a safe Manim-target fallback for math explainers

## Run locally

```bash
npm install
npx prisma migrate deploy
npm run dev
```

For the clean CI path use `npm ci && npm run build`; Prisma Client generation is part of the lifecycle scripts.

The app reads runtime configuration from environment variables supplied by your shell or hosting provider. Set `GEMINI_API_KEY` for ingestion and the scripted fallback; the general model defaults to `gemini-3.1-flash-lite`. Set `OPENAI_API_KEY` to enable the realtime professor. Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` for a deployed tldraw canvas (localhost development does not require one).

For real MP4 explainers in the single-process Build Week demo, set `RENDER_LOCAL_ENABLED=true`; the installed HyperFrames worker validates, renders, duration-checks, and publishes to `public/generated-artifacts/`. For a separate worker, set `REDIS_URL` and `RENDER_QUEUE_ENABLED=true`, then run `npm run render:worker`. Cloudflare R2 variables are optional; when configured, completed MP4s are uploaded there instead of local public storage. `RENDER_DEBUG=true` keeps scratch jobs for inspection.

## Cost controls

studydeck uses versioned, content-addressed caches for outputs that are safe to replay:

- PDF analysis is keyed by the uploaded file hash. With R2 configured, a fresh app instance can recover the saved deck manifest without re-uploading the PDF to Gemini.
- Lecture segments are keyed by the model, teaching settings, custom instructions, current slide, and next-slide context.
- Scripted lecture TTS is keyed by provider, model, voice, and exact transcript. The first play streams normally; replays return the stored audio without another TTS request.
- Visual explainers are keyed by their validated specification and reuse completed R2 MP4s even if the local artifact database is rebuilt.

Local entries live under `.aiprof-cache/model-outputs/`; R2 mirrors them under `model-cache/`. Learner Q&A, realtime conversation audio, teach-back feedback, and whiteboard decisions are intentionally not persisted in the shared output cache. The studio prefetches only the current and next scripted slide, and does not prefetch until audio playback is available.

## Useful commands

```bash
npm run dev
npm run lint
npm run build
npm test
```

`postinstall` and `prebuild` run `prisma generate`, so a clean install/build does not require a manual Prisma command.

## API routes

| Route | Description |
|-------|-------------|
| `POST /api/decks` | Save a prepared deck |
| `GET /api/decks` | List saved decks |
| `DELETE /api/decks/:id` | Delete a deck |
| `POST /api/sessions` | Start a study session |
| `GET /api/sessions` | List sessions |
| `PATCH /api/sessions/:id` | Save session progress |
| `POST /api/sessions/:id/events` | Persist realtime turns and tool events |
| `GET /api/sessions/:id/memory` | Export transcript, board history, events, and artifacts |
| `GET /api/learning/signals` | Read the learner's upcoming recall queue |
| `POST /api/learning/signals` | Record teach-back evidence and schedule review |
| `POST /api/lecture/prepare` | Render a PDF and annotate its slides |
| `POST /api/lecture/segment` | Generate narration beats |
| `POST /api/lecture/question` | Answer a question in slide context |
| `POST /api/lecture/tts` | Synthesize lecture speech |
| `POST /api/lecture/tts/stream` | Stream or replay cached scripted speech |
| `POST /api/lecture/whiteboard/step` | Generate a whiteboard step |
| `POST /api/live/token` | Create a live lecture token |
| `POST /api/realtime/session` | Mint a short-lived OpenAI realtime client secret |
| `POST /api/render-jobs` | Create or reuse a validated visual explainer artifact |
| `GET /api/render-jobs/:id` | Read explainer job status |
| `GET /api/render-jobs/:id/preview` | View the deterministic inline explainer preview |
