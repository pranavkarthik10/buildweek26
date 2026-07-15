# Build Week 26

AI Professor turns a PDF lecture deck into a structured lesson and interactive teaching session with narration, Q&A, and a whiteboard.

## Core flow

1. Open `/dashboard` (the root route redirects there).
2. Upload a PDF at `/deck/new`.
3. Let the AI prepare the deck, then choose a teaching style.
4. Run or resume the session at `/session/:id`.

## Stack

- Next.js 16 App Router
- TypeScript and Tailwind CSS v4
- Prisma 7 with SQLite for local development
- Gemini for lecture generation, live teaching, TTS, and Q&A
- tldraw for the interactive whiteboard

## Run locally

```bash
npm install
npx prisma migrate deploy
npm run dev
```

The app reads its runtime configuration from environment variables supplied by your shell or hosting provider. The main AI variables are `GEMINI_API_KEY`, `GEMINI_GENERAL_MODEL`, `GEMINI_LIVE_MODEL`, and `GEMINI_TTS_MODEL`. Optional voice and Cloudflare R2 variables are documented by their usage in `src/lib`.

## Useful commands

```bash
npm run dev
npm run lint
npm run build
```

## API routes

| Route | Description |
|-------|-------------|
| `POST /api/decks` | Save a prepared deck |
| `GET /api/decks` | List saved decks |
| `DELETE /api/decks/:id` | Delete a deck |
| `POST /api/sessions` | Start a study session |
| `GET /api/sessions` | List sessions |
| `PATCH /api/sessions/:id` | Save session progress |
| `POST /api/lecture/prepare` | Render a PDF and annotate its slides |
| `POST /api/lecture/segment` | Generate narration beats |
| `POST /api/lecture/question` | Answer a question in slide context |
| `POST /api/lecture/tts` | Synthesize lecture speech |
| `POST /api/lecture/whiteboard/step` | Generate a whiteboard step |
| `POST /api/live/token` | Create a live lecture token |
