declare module "plotly.js-basic-dist-min" {
  const plotly: {
    newPlot: (node: HTMLElement, data: unknown[], layout: unknown, config?: unknown) => Promise<unknown>;
    purge: (node: HTMLElement) => void;
  };
  export = plotly;
}

declare module "jsxgraph" {
  const jsxgraph: unknown;
  export = jsxgraph;
}
