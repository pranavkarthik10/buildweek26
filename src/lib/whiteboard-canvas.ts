import {
  createShapeId,
  type Editor,
  type TLDefaultColorStyle,
} from "@tldraw/tldraw";

import type { WhiteboardCanvasAction } from "@/lib/whiteboard-types";

const BOARD_W = 900;
const BOARD_H = 560;

function toPageX(percent: number) {
  return (percent / 100) * BOARD_W;
}

function toPageY(percent: number) {
  return (percent / 100) * BOARD_H;
}

export function applyWhiteboardCanvasActions(
  editor: Editor,
  actions: WhiteboardCanvasAction[],
) {
  if (!actions.length) return;

  const shapes = actions
    .map((action) => actionToShape(action))
    .filter((shape): shape is NonNullable<ReturnType<typeof actionToShape>> => shape !== null);

  if (!shapes.length) return;

  editor.createShapes(shapes as Parameters<Editor["createShapes"]>[0]);
}

function actionToShape(action: WhiteboardCanvasAction) {
  const shapeId = createShapeId(action.id);
  const color = normalizeColor(action.color);

  if (action.type === "text") {
    return {
      id: shapeId,
      type: "text" as const,
      x: toPageX(action.x),
      y: toPageY(action.y),
      props: {
        richText: toRichText(action.text),
        size: "m" as const,
        color,
        font: "draw" as const,
        autoSize: true,
      },
    };
  }

  if (action.type === "geo") {
    return {
      id: shapeId,
      type: "geo" as const,
      x: toPageX(action.x),
      y: toPageY(action.y),
      props: {
        geo: action.geo,
        w: Math.max(24, toPageX(action.w)),
        h: Math.max(24, toPageY(action.h)),
        color,
        fill: "none" as const,
        dash: "draw" as const,
        size: "m" as const,
      },
    };
  }

  if (action.type === "arrow") {
    const x1 = toPageX(action.x1);
    const y1 = toPageY(action.y1);
    const x2 = toPageX(action.x2);
    const y2 = toPageY(action.y2);

    return {
      id: shapeId,
      type: "arrow" as const,
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      props: {
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        color,
        size: "m" as const,
        arrowheadStart: "none" as const,
        arrowheadEnd: "arrow" as const,
      },
    };
  }

  if (action.type === "draw" && action.points.length >= 2) {
    const points = action.points.map((point) => ({
      x: toPageX(point.x),
      y: toPageY(point.y),
    }));

    return {
      id: shapeId,
      type: "draw" as const,
      x: points[0].x,
      y: points[0].y,
      props: {
        segments: [
          {
            type: "free" as const,
            points: points.map((point, index) => ({
              x: point.x - points[0].x,
              y: point.y - points[0].y,
              z: index === 0 ? 0.5 : 0.5,
            })),
          },
        ],
        color,
        size: "m" as const,
      },
    };
  }

  return null;
}

function normalizeColor(value?: string): TLDefaultColorStyle {
  const allowed: TLDefaultColorStyle[] = [
    "black",
    "blue",
    "green",
    "grey",
    "light-blue",
    "light-green",
    "light-red",
    "light-violet",
    "orange",
    "red",
    "violet",
    "white",
    "yellow",
  ];

  if (value && allowed.includes(value as TLDefaultColorStyle)) {
    return value as TLDefaultColorStyle;
  }

  return "blue";
}

function toRichText(text: string) {
  return {
    type: "doc" as const,
    content: [
      {
        type: "paragraph" as const,
        content: [{ type: "text" as const, text }],
      },
    ],
  };
}