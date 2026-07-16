import type { WhiteboardCanvasAction } from "@/lib/whiteboard-types";

export type BoardTransaction = {
  transactionId: string;
  baseVersion: number;
  ops: WhiteboardCanvasAction[];
};

export type BoardValidation =
  | { ok: true; transaction: BoardTransaction }
  | { ok: false; code: "invalid" | "conflict"; error: string; currentVersion?: number };

const colors = new Set([
  "black", "blue", "green", "grey", "light-blue", "light-green", "light-red",
  "light-violet", "orange", "red", "violet", "white", "yellow",
]);
const geos = new Set(["rectangle", "ellipse", "triangle"]);

/** Validate and normalize the small, idempotent board transaction accepted by the agent. */
export function validateBoardTransaction(input: unknown, currentVersion: number): BoardValidation {
  if (!input || typeof input !== "object") return invalid("Transaction must be an object.");
  const value = input as Record<string, unknown>;
  const transactionId = text(value.transactionId, 96);
  const baseVersion = value.baseVersion;
  const ops = value.ops;
  if (!transactionId || !/^[a-zA-Z0-9._:-]+$/.test(transactionId)) return invalid("transactionId is invalid.");
  if (!Number.isSafeInteger(baseVersion) || (baseVersion as number) < 0) return invalid("baseVersion must be a non-negative integer.");
  if ((baseVersion as number) !== currentVersion) {
    return { ok: false, code: "conflict", error: "Board version is stale; reread the board before retrying.", currentVersion };
  }
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > 12) return invalid("ops must contain 1 to 12 operations.");

  const normalized: WhiteboardCanvasAction[] = [];
  for (const op of ops) {
    const result = normalizeOperation(op);
    if (!result.ok) return result;
    normalized.push(result.action);
  }
  return { ok: true, transaction: { transactionId, baseVersion: baseVersion as number, ops: normalized } };
}

function normalizeOperation(value: unknown): { ok: true; action: WhiteboardCanvasAction } | { ok: false; code: "invalid"; error: string } {
  if (!value || typeof value !== "object") return invalid("Every board operation must be an object.");
  const op = value as Record<string, unknown>;
  const type = op.type;
  const id = text(op.id, 80);
  if (!id || !["text", "geo", "arrow", "draw"].includes(String(type))) return invalid("Every operation needs a valid type and id.");
  const color = text(op.color, 30);
  if (color && !colors.has(color)) return invalid("Board color is not allowlisted.");

  if (type === "text") {
    const x = percent(op.x);
    const y = percent(op.y);
    const content = text(op.text, 600);
    if (x === null || y === null || !content) return invalid("Text operations need bounded x, y, and text.");
    return { ok: true, action: { type: "text", id, x, y, text: content, ...(color ? { color } : {}) } };
  }
  if (type === "geo") {
    const x = percent(op.x);
    const y = percent(op.y);
    const w = percent(op.w);
    const h = percent(op.h);
    const geo = typeof op.geo === "string" ? op.geo : "";
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0 || !geos.has(geo)) return invalid("Geometry operations need bounded position, size, and geo.");
    return { ok: true, action: { type: "geo", id, x, y, w, h, geo: geo as "rectangle" | "ellipse" | "triangle", ...(color ? { color } : {}) } };
  }
  if (type === "arrow") {
    const x1 = percent(op.x1);
    const y1 = percent(op.y1);
    const x2 = percent(op.x2);
    const y2 = percent(op.y2);
    if ([x1, y1, x2, y2].some((point) => point === null)) return invalid("Arrow operations need bounded endpoints.");
    return { ok: true, action: { type: "arrow", id, x1: x1 as number, y1: y1 as number, x2: x2 as number, y2: y2 as number, ...(color ? { color } : {}) } };
  }

  const points = Array.isArray(op.points)
    ? op.points.map((point) => {
        if (!point || typeof point !== "object") return null;
        const item = point as Record<string, unknown>;
        const x = percent(item.x);
        const y = percent(item.y);
        return x === null || y === null ? null : { x, y };
      })
    : [];
  if (points.length < 2 || points.length > 80 || points.some((point) => point === null)) return invalid("Draw operations need 2 to 80 bounded points.");
  return { ok: true, action: { type: "draw", id, points: points as Array<{ x: number; y: number }>, ...(color ? { color } : {}) } };
}

function percent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function invalid(error: string): { ok: false; code: "invalid"; error: string } {
  return { ok: false, code: "invalid", error };
}
