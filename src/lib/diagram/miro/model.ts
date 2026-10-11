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

/** Figure kinds Miro draws, by the name the adapters use. `document` is a
 * stencil (`flowchart-document`), not a `shape` id - the encoder writes
 * `widgetData.type: "stencil"` for it (T-0732). */
export type MiroShapeKind = "rect" | "circle" | "round" | "diamond" | "cylinder" | "document";

/**
 * Miro's figure ids, taken from the clipboard samples (`shape` and
 * `style.st` carry the same number). `document` has no entry: it encodes as
 * a stencil, never as a `shape`.
 */
export const MIRO_SHAPE_IDS: Record<Exclude<MiroShapeKind, "document">, string> = {
  rect: "3",
  circle: "4",
  round: "7",
  diamond: "8",
  cylinder: "26",
};

/** Schema id of the document stencil, from the owner's stencil sample. */
export const MIRO_DOCUMENT_STENCIL_ID = "flowchart-document";
/** Collection of the document stencil, from the owner's stencil sample. */
export const MIRO_DOCUMENT_STENCIL_COLLECTION = "flowchart";

/** True when a figure kind encodes as a stencil rather than a `shape`. */
export function isMiroStencilShape(shape: MiroShapeKind): shape is "document" {
  return shape === "document";
}

/**
 * Maps a figure name to a Miro kind. `document` stays a document (a stencil);
 * unknown figures fall back to a rectangle: the shape is still editable in
 * Miro, only its kind is lost (until a sample pins down its id).
 */
export function resolveMiroShape(shape: string): MiroShapeKind {
  if (shape === "document") return "document";
  const kinds = Object.keys(MIRO_SHAPE_IDS) as MiroShapeKind[];
  return kinds.includes(shape as MiroShapeKind) ? (shape as MiroShapeKind) : "rect";
}

/** A figure with centred text. `border` is a 24-bit RGB int, or null for Miro's default.
 * A `document` figure encodes as a `stencil` (`flowchart-document`), not a
 * `shape` - the encoder branches on it, so it still lives in `shapes` and
 * keeps its order, frame parenting, selection and plain-text handling. */
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
  /** Outline width (`brw`); absent means the encoder's default. The use case
   * adapter sets it for a system, whose outline is thick on the canvas. */
  borderWidth?: number;
  /**
   * Key of the frame that owns this figure; absent means a top-level figure.
   * The encoder writes `_parent` and a `parentOffsetPx` position for it, so
   * the child moves with its frame on the board. No current adapter sets one
   * (flow lanes became background rectangles in T-0733, architecture frames
   * in T-0735); the path stays so older scenes, the encoder and the decoder
   * keep working. Stickies and free texts never carry one: they stay
   * independent.
   */
  frame?: string;
  /**
   * Key of the background rectangle this figure belongs to: a flow lane (a
   * scene key from `adapters/flow.ts`) or an architecture frame (a scene key
   * from `adapters/architecture.ts`); absent means the figure stands in no
   * group. This is selection grouping only, never parenting: the encoder
   * ignores it, so the figure pastes as a top-level figure with a
   * `canvasOffsetPx` position and stays freely movable on the board, while
   * the right-click selection copy keeps the rectangles that hold a selected
   * figure (T-0733 for lanes, T-0735 for frames).
   */
  lane?: string;
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

/** A frame holding other elements. No current adapter emits one (flow lanes
 * stopped in T-0733, architecture frames in T-0735); the node and its encoder
 * path stay so older scenes keep working. */
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

/**
 * A free-floating straight line (the 2x2 matrix axes): both ends unbound, so
 * the encoder writes `widgetIndex: -1` with absolute `point` positions and no
 * arrowheads (`a_start`/`a_end` 0, `lt` 0). Coordinates are scene pixels, like
 * every other position in this model.
 */
export interface MiroFreeLine {
  kind: "freeLine";
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MiroScene {
  shapes: MiroShapeNode[];
  stickers: MiroSticker[];
  texts: MiroTextNode[];
  frames: MiroFrameNode[];
  connectors: MiroConnector[];
  /**
   * Free-floating lines. Optional so every scene built before them (and
   * `emptyScene()`) stays exactly as it was; the encoder reads an absent
   * list as none.
   */
  freeLines?: MiroFreeLine[];
}

/** An empty scene: every adapter starts here and pushes what the layout holds. */
export function emptyScene(): MiroScene {
  return { shapes: [], stickers: [], texts: [], frames: [], connectors: [] };
}
