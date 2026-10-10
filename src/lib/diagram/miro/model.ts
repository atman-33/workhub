/**
 * The intermediate model between a diagram layout and Miro's clipboard
 * format (T-0720).
 *
 * A diagram kind contributes an adapter (`adapters/`) that turns its layout
 * result into a `MiroScene`; `encode.ts` is the only module that knows the
 * `miro-data-v1` format, so when Miro changes it only the encoder (and
 * `palette.ts`) needs to change. Coordinates are diagram pixels, and every
 * position is the centre of its element.
 */

/** Figure kinds Miro draws, by the name the adapters use. */
export type MiroShapeKind = "rect" | "circle" | "round" | "diamond" | "cylinder";

/**
 * Miro's figure ids, taken from the clipboard samples (`shape` and
 * `style.st` carry the same number).
 */
export const MIRO_SHAPE_IDS: Record<MiroShapeKind, string> = {
  rect: "3",
  circle: "4",
  round: "7",
  diamond: "8",
  cylinder: "26",
};

/**
 * Maps a figure name to a Miro kind. Unknown figures fall back to a
 * rectangle: the shape is still editable in Miro, only its kind is lost
 * (until a sample pins down its id).
 */
export function resolveMiroShape(shape: string): MiroShapeKind {
  const kinds = Object.keys(MIRO_SHAPE_IDS) as MiroShapeKind[];
  return kinds.includes(shape as MiroShapeKind) ? (shape as MiroShapeKind) : "rect";
}

/** A figure with centred text. `border` is a 24-bit RGB int, or null for Miro's default. */
export interface MiroShapeNode {
  kind: "shape";
  /** Adapter-side identity (e.g. the diagram node id); the encoder maps it to a numeric id. */
  key: string;
  shape: MiroShapeKind;
  cx: number;
  cy: number;
  width: number;
  height: number;
  text: string;
  border: number | null;
  fontSize: number;
}

/** A sticky note. Miro draws it at its own fixed size; `cx`/`cy` is where its centre lands. */
export interface MiroSticker {
  kind: "sticker";
  key: string;
  cx: number;
  cy: number;
  text: string;
  /** 24-bit RGB int for the paper. */
  background: number;
}

/** A free text label (axis and quadrant names in later adapters; unused by the PFD). */
export interface MiroTextNode {
  kind: "text";
  key: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  text: string;
}

/** A frame holding other elements (lanes and architecture frames in later adapters). */
export interface MiroFrameNode {
  kind: "frame";
  key: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  title: string;
}

/** One end of a connector: the element it is bound to and the spot on it (0..1). */
export interface MiroEndpoint {
  key: string;
  x: number;
  y: number;
}

export interface MiroConnector {
  kind: "connector";
  key: string;
  from: MiroEndpoint;
  to: MiroEndpoint;
  label?: string;
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export interface MiroScene {
  shapes: MiroShapeNode[];
  stickers: MiroSticker[];
  texts: MiroTextNode[];
  frames: MiroFrameNode[];
  connectors: MiroConnector[];
}

/** An empty scene: every adapter starts here and pushes what the layout holds. */
export function emptyScene(): MiroScene {
  return { shapes: [], stickers: [], texts: [], frames: [], connectors: [] };
}
