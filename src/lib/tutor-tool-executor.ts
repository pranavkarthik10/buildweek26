import { requestExplainerArtifact } from "@/lib/explainer-artifacts";
import type { ExplainerRequestInput } from "@/lib/explainer-types";
import { recordLearningSignal } from "@/lib/learning-service";
import { validateBoardTransaction } from "@/lib/whiteboard-transaction";
import {
  hasExplicitVisualIntent,
  isTutorToolName,
  resolveSlideIndex,
  searchCourseMaterial,
  type TutorContext,
  type TutorEffect,
  type TutorToolName,
  type TutorToolTrace,
  validateTutorToolArgs,
} from "@/lib/tutor-tools";

export type ExecutedTutorTool = {
  output: Record<string, unknown>;
  effects: TutorEffect[];
  trace: TutorToolTrace;
};

export async function executeTutorTool(
  name: string,
  rawArgs: unknown,
  context: TutorContext,
  userId: string,
): Promise<ExecutedTutorTool> {
  if (!isTutorToolName(name)) {
    return failedTool(name, "Unknown tutor tool.");
  }

  const parsed = validateTutorToolArgs(name, rawArgs);
  if (!parsed.success) {
    return failedTool(name, "Tool arguments failed validation.");
  }

  try {
    switch (name) {
      case "set_teaching_focus": {
        const args = parsed.data as { mode: "slides" | "split" | "whiteboard" };
        const mode = args.mode;
        return completedTool(name, { ok: true, focus: mode }, [{ type: name, mode }]);
      }
      case "navigate_slide": {
        const args = parsed.data as { slideIndex: number };
        const slideIndex = resolveSlideIndex(context.deck, args.slideIndex, context.learnerQuestion);
        if (slideIndex >= context.deck.slides.length) return failedTool(name, "Slide is outside the current deck.");
        return completedTool(name, { ok: true, slideIndex }, [{ type: name, slideIndex }]);
      }
      case "point_to_slide": {
        const args = parsed.data as { slideIndex?: number; x: number; y: number; label: string };
        const slideIndex = resolveSlideIndex(context.deck, args.slideIndex ?? context.currentSlideIndex, context.learnerQuestion);
        if (slideIndex >= context.deck.slides.length) return failedTool(name, "Slide is outside the current deck.");
        return completedTool(name, { ok: true, slideIndex, x: args.x, y: args.y, label: args.label }, [{
          type: name,
          slideIndex,
          x: args.x,
          y: args.y,
          label: args.label,
        }]);
      }
      case "read_whiteboard": {
        const args = parsed.data as { includeImage?: boolean; sinceVersion?: number };
        const board = context.board;
        if (!board) return completedTool(name, { ok: true, version: 0, shapes: [], imageIncluded: false });
        const sinceVersion = args.sinceVersion;
        const diff = board.diff && (sinceVersion === undefined || board.diff.version > sinceVersion)
          ? board.diff
          : undefined;
        return completedTool(name, {
          ok: true,
          version: board.version,
          shapes: board.shapes.slice(0, 120),
          diff,
          imageIncluded: Boolean(args.includeImage && board.imageDataUrl),
          imageUnavailable: Boolean(args.includeImage && !board.imageDataUrl),
        });
      }
      case "mutate_whiteboard": {
        const args = parsed.data as { transactionId: string; baseVersion: number; ops: unknown[]; explanation?: string; presentation?: "split" | "whiteboard"; presentationReason?: "single_edit" | "multi_step" | "artifact_playback" | "user_requested" };
        if (!context.board) return failedTool(name, "No active whiteboard is available.");
        const validation = validateBoardTransaction(args, context.board.version);
        if (!validation.ok) {
          return failedTool(name, validation.error, { code: validation.code, currentVersion: validation.currentVersion });
        }
        return completedTool(name, {
          ok: true,
          applied: validation.transaction.ops.length,
          baseVersion: validation.transaction.baseVersion,
        }, [{
          type: name,
           transaction: validation.transaction,
           explanation: args.explanation,
           presentation: args.presentation ?? "split",
           presentationReason: args.presentationReason ?? "single_edit",
        }]);
      }
      case "search_course_material": {
        const args = parsed.data as { query: string; limit?: number };
        const results = searchCourseMaterial(context.deck, args.query, args.limit ?? 3);
        return completedTool(name, { ok: true, query: args.query, results });
      }
      case "create_micro_explainer": {
        const args = parsed.data as { question: string; concept: string; goal: string; durationSec: 15 | 30 | 45; visualStyle?: "clean" | "chalk" | "math" | "diagram" };
        const learnerRequest = context.learnerQuestion ?? args.question;
        if (!hasExplicitVisualIntent(learnerRequest, context.visualIntent)) {
          return failedTool(name, "A visual explainer requires explicit learner intent.");
        }
        const artifact = await createExplainerArtifact({
          sessionId: context.sessionId,
          question: args.question,
          concept: args.concept,
          goal: args.goal,
          durationSec: args.durationSec,
          visualStyle: args.visualStyle,
          deckTitle: context.deck.deckTitle,
          courseName: context.deck.courseName,
          slide: context.currentSlide,
        });
        const effect: TutorEffect = {
          type: name,
          jobId: artifact.jobId,
          status: artifact.status,
          kind: artifact.kind,
          engine: artifact.engine,
          url: artifact.url,
          specUrl: `/api/render-jobs/${artifact.jobId}/spec`,
          audioUrl: artifact.audioUrl,
          captions: artifact.captions,
        };
        return completedTool(name, { ok: true, ...artifact }, [effect]);
      }
      case "record_learning_signal": {
        const args = parsed.data as { concept: string; outcome: "correct" | "partial" | "incorrect" | "uncertain"; evidence: string; misconception?: string; preferredExplanationStyle?: string };
        if (!context.sessionId) return failedTool(name, "A session is required to record learning signals.");
        const result = await recordLearningSignal({
          userId,
          sessionId: context.sessionId,
          concept: args.concept,
          outcome: args.outcome,
          evidence: args.evidence,
          misconception: args.misconception,
          preferredExplanationStyle: args.preferredExplanationStyle,
        });
        return completedTool(name, {
          ok: true,
          concept: args.concept,
          outcome: args.outcome,
          masteryScore: result.conceptState.masteryScore,
          nextReviewAt: result.reviewItem.dueAt.toISOString(),
        });
      }
    }
  } catch (error) {
    return failedTool(name, error instanceof Error ? error.message : "Tool execution failed.");
  }
}

function completedTool(name: TutorToolName, output: Record<string, unknown>, effects: TutorEffect[] = []): ExecutedTutorTool {
  return { output, effects, trace: { name, status: "completed" } };
}

function failedTool(name: string, error: string, details?: Record<string, unknown>): ExecutedTutorTool {
  const safeName = isTutorToolName(name) ? name : "search_course_material";
  return {
    output: { ok: false, error, ...details },
    effects: [],
    trace: { name: safeName, status: "failed", error },
  };
}

async function createExplainerArtifact(input: ExplainerRequestInput) {
  const { artifact } = await requestExplainerArtifact(input);
  return {
    jobId: artifact.id,
    status: artifact.status,
    kind: artifact.kind,
    engine: artifact.engine,
    url: artifact.artifactUrl ?? `/api/render-jobs/${artifact.id}/spec`,
    audioUrl: artifact.audioUrl ?? undefined,
    captions: artifact.captions ? safelyParseJson(artifact.captions) : undefined,
  };
}

function safelyParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
