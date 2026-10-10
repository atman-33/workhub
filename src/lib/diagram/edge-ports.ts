/**
 * The pinned ends of an arrow, as written on an edge line (T-0712, T-0718).
 *
 * An end names an id with an optional side and ratio: `C-004`, `C-004:E`,
 * `C-004:E@0.5`. The side is an edge of the box (`N`/`E`/`S`/`W`); the ratio
 * runs 0 to 1 along it and defaults to the middle. An end without one is
 * routed as always. Parsing and writing live here so every kind that pins
 * ends reads the same lines; what a pin *does* is geometry (`node-edge.ts`).
 */
import type { EdgeOptions, EdgePort, PortSide } from "./node-edge";

const END_RE = /^([A-Za-z]{1,3}-\d+)((?::([NESW]))(?:@(\d+(?:\.\d+)?))?)?$/;

/** Splits `C-004:E@0.5` into its id and port; `null` when it names no end. */
export function parseEdgeEnd(token: string): { id: string; port?: EdgePort } | null {
  const m = END_RE.exec(token);
  if (!m) return null;
  const port = m[2]
    ? {
        side: m[3] as PortSide,
        ...(m[4] !== undefined ? { at: Math.min(1, Math.max(0, Number(m[4]))) } : {}),
      }
    : undefined;
  return { id: m[1], ...(port ? { port } : {}) };
}

/** Renders an end back: the id with its pinned side and ratio, if any. */
export function formatEdgeEnd(id: string, port: EdgePort | undefined): string {
  if (!port) return id;
  return `${id}:${port.side}${port.at === undefined ? "" : `@${Number(port.at.toFixed(2))}`}`;
}

/**
 * `{ ports }` for an edge geometry call, or `{}` when the edge is automatic.
 * Every kind's layout spreads this into its router options.
 */
export function portsOption(edge: {
  fromPort?: EdgePort;
  toPort?: EdgePort;
}): Pick<EdgeOptions, "ports"> {
  if (!edge.fromPort && !edge.toPort) return {};
  const ports: { from?: EdgePort; to?: EdgePort } = {};
  if (edge.fromPort) ports.from = edge.fromPort;
  if (edge.toPort) ports.to = edge.toPort;
  return { ports };
}
