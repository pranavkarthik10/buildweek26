-- Migrate the single-user Build Week artifact table to the validated visual contract.
-- Existing HyperFrames rows are intentionally removed by the approved cleanup plan.
DELETE FROM "Artifact" WHERE "engine" = 'hyperframes';

ALTER TABLE "Artifact" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'interactive';
ALTER TABLE "Artifact" ADD COLUMN "audioUrl" TEXT;
ALTER TABLE "Artifact" ADD COLUMN "captions" TEXT;
ALTER TABLE "Artifact" ADD COLUMN "specVersion" INTEGER NOT NULL DEFAULT 2;

UPDATE "Artifact" SET "kind" = CASE WHEN "engine" = 'manim' THEN 'video' ELSE 'interactive' END;
