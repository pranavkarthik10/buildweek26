ALTER TABLE "SessionTurn" ADD COLUMN "signalKey" TEXT;

CREATE UNIQUE INDEX "SessionTurn_sessionId_signalKey_key"
ON "SessionTurn"("sessionId", "signalKey");
