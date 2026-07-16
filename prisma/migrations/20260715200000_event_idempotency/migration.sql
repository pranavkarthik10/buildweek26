ALTER TABLE "SessionEvent" ADD COLUMN "clientEventId" TEXT;

CREATE UNIQUE INDEX "SessionEvent_sessionId_clientEventId_key"
ON "SessionEvent"("sessionId", "clientEventId");
