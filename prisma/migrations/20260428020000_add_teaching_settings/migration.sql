-- AlterTable
ALTER TABLE "StudySession" ADD COLUMN "teachingFormat" TEXT NOT NULL DEFAULT 'lecture';
ALTER TABLE "StudySession" ADD COLUMN "customInstructions" TEXT;
