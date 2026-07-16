-- Realtime session state is intentionally stored as serialized JSON so the
-- existing SQLite demo can persist tldraw documents without a JSON column.
ALTER TABLE "StudySession" ADD COLUMN "boardSnapshot" TEXT;
ALTER TABLE "StudySession" ADD COLUMN "boardVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StudySession" ADD COLUMN "lastEventSeq" INTEGER NOT NULL DEFAULT 0;
