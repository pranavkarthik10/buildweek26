import type { ManimVisualSpec, MathExpression } from "@/lib/explainer-types";

export function compileManimScene(spec: ManimVisualSpec) {
  const objects = spec.objects.some((object) => object.type === "axes")
    ? spec.objects
    : spec.objects.some((object) => object.type === "graph")
      ? [{ type: "axes" as const, id: "axes", xRange: [-5, 5] as [number, number], yRange: [-3, 3] as [number, number] }, ...spec.objects]
      : spec.objects;
  const objectLines = objects.map((object) => {
    if (object.type === "text") return `    objects[${py(object.id)}] = Text(${py(object.text)}, font_size=42).move_to(${point(object.x ?? 0, object.y ?? 0)})`;
    if (object.type === "formula") return `    objects[${py(object.id)}] = MathTex(${py(object.latex)}).move_to(${point(object.x ?? 0, object.y ?? 0)})`;
    if (object.type === "circle") return `    objects[${py(object.id)}] = Circle(radius=${number(object.radius)}).move_to(${point(object.x, object.y)})`;
    if (object.type === "line" || object.type === "arrow") return `    objects[${py(object.id)}] = ${object.type === "arrow" ? "Arrow" : "Line"}(${point(object.from[0], object.from[1])}, ${point(object.to[0], object.to[1])})`;
    if (object.type === "axes") return `    objects[${py(object.id)}] = Axes(x_range=[${number(object.xRange[0])}, ${number(object.xRange[1])}], y_range=[${number(object.yRange[0])}, ${number(object.yRange[1])}], x_length=10, y_length=6)`;
    if (object.type === "graph") return `    objects[${py(object.id)}] = objects["axes"].plot(lambda x: ${expressionToPython(object.expression)}, x_range=[${number(object.domain[0])}, ${number(object.domain[1])}])`;
    return "";
  }).join("\n");

  const actions = spec.actions.map((action) => {
    const duration = number(action.durationSec);
    if (action.type === "transform") return `    self.play(Transform(objects[${py(action.fromId)}], objects[${py(action.toId)}]), run_time=${duration})`;
    const animation = action.type === "write" ? "Write" : action.type === "create" || action.type === "fadeIn" ? "FadeIn" : action.type === "fadeOut" ? "FadeOut" : "Indicate";
    return `    self.play(${animation}(objects[${py(action.targetId)}]), run_time=${duration})`;
  }).join("\n");

  return `from manim import *\nimport numpy as np\n\nclass StudydeckScene(Scene):\n  def construct(self):\n    objects = {}\n${objectLines}\n${actions}\n`;
}

export function expressionToPython(expression: MathExpression): string {
  switch (expression.type) {
    case "constant": return number(expression.value);
    case "variable": return expression.name;
    case "add": return `(${expressionToPython(expression.left)} + ${expressionToPython(expression.right)})`;
    case "subtract": return `(${expressionToPython(expression.left)} - ${expressionToPython(expression.right)})`;
    case "multiply": return `(${expressionToPython(expression.left)} * ${expressionToPython(expression.right)})`;
    case "divide": return `(${expressionToPython(expression.left)} / (${expressionToPython(expression.right)} or 1))`;
    case "power": return `(${expressionToPython(expression.base)} ** ${number(expression.exponent)})`;
    case "sin": return `np.sin(${expressionToPython(expression.value)})`;
    case "cos": return `np.cos(${expressionToPython(expression.value)})`;
    case "tan": return `np.tan(${expressionToPython(expression.value)})`;
    case "exp": return `np.exp(${expressionToPython(expression.value)})`;
    case "log": return `np.log(np.maximum(${expressionToPython(expression.value)}, 1e-6))`;
    case "sqrt": return `np.sqrt(np.maximum(${expressionToPython(expression.value)}, 0))`;
  }
}

function point(x: number, y: number) {
  return `np.array([${number(x)}, ${number(y)}, 0])`;
}

function number(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 1_000_000) / 1_000_000) : "0";
}

function py(value: string) {
  return JSON.stringify(value);
}
