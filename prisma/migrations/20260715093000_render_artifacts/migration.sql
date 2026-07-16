CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT,
    "jobKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "engine" TEXT NOT NULL DEFAULT 'hyperframes',
    "spec" TEXT NOT NULL,
    "previewUrl" TEXT,
    "artifactUrl" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Artifact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Artifact_jobKey_key" ON "Artifact"("jobKey");
CREATE INDEX "Artifact_sessionId_createdAt_idx" ON "Artifact"("sessionId", "createdAt");
