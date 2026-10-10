/**
 * Layered layout for diagrams of boxes and arrows (T-0682).
 *
 * `rankNodes` decides the column of each node from the arrows alone, ignoring
 * the ones that point backwards (a loop), and `layerLayout` turns the ranks
 * into coordinates: columns are ranks, rows are whatever key the kind chooses
 * (a swimlane for the business flow, a single row for the PFD's starting
 * layout).
 */

export interface RankEdge {
  from: string;
  to: string;
}

export interface RankResult {
  /** Column of every node: 0 for a node nothing flows into, else one more than
   * the deepest node that flows into it. */
  rank: Map<string, number>;
  /** Per input edge (same order): true when it points backwards - it closes a
   * loop - and so took no part in the ranking. Edges naming an unknown node
   * are false. */
  back: boolean[];
}

/**
 * Ranks nodes by longest path, after taking out the arrows that close a loop.
 *
 * A loop is found by a depth-first walk that starts from the nodes nothing
 * flows into and follows arrows in the order they were written; an arrow that
 * reaches a node still on the walk's stack goes back to it, and is the loop's
 * "return". Removing exactly those arrows leaves a graph with no cycle, which
 * the longest-path ranking needs.
 */
export function rankNodes(ids: string[], edges: RankEdge[]): RankResult {
  const known = new Set(ids);
  const usable = edges.map((e) => known.has(e.from) && known.has(e.to));
  const out = new Map<string, number[]>(ids.map((id) => [id, []]));
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  edges.forEach((e, i) => {
    if (!usable[i]) return;
    out.get(e.from)!.push(i);
    if (e.from !== e.to) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  });

  const back = edges.map(() => false);
  const state = new Map<string, 0 | 1 | 2>(); // absent: unseen, 1: on the stack, 2: done
  const visit = (id: string) => {
    state.set(id, 1);
    for (const i of out.get(id) ?? []) {
      const to = edges[i].to;
      const s = state.get(to);
      if (s === 1) back[i] = true;
      else if (s === undefined) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (indegree.get(id) === 0 && !state.has(id)) visit(id);
  // What is left sits on a cycle with no entry (A -> B -> A) or hangs off one.
  for (const id of ids) if (!state.has(id)) visit(id);

  const incoming = new Map<string, string[]>(ids.map((id) => [id, []]));
  edges.forEach((e, i) => {
    if (usable[i] && !back[i]) incoming.get(e.to)!.push(e.from);
  });
  const rank = new Map<string, number>();
  const rankOf = (id: string): number => {
    const cached = rank.get(id);
    if (cached !== undefined) return cached;
    let r = 0;
    for (const from of incoming.get(id) ?? []) r = Math.max(r, rankOf(from) + 1);
    rank.set(id, r);
    return r;
  };
  for (const id of ids) rankOf(id);
  return { rank, back };
}

export interface LayerNodeInput {
  id: string;
  width: number;
  height: number;
  /** Which row the node sits in: one of `options.rows`. */
  row: string;
}

export interface LayerLayoutOptions {
  /** The rows, top to bottom. A node naming another row goes to the first. */
  rows: string[];
  /** Left edge of the first column. */
  originX?: number;
  /** Top edge of the first row. */
  originY?: number;
  /** Space between two columns. */
  columnGap?: number;
  /** Space between two nodes stacked in one row of one column. */
  slotGap?: number;
  /** Space above and below the nodes of a row. */
  rowPad?: number;
  /** Least height of a row. */
  minRowHeight?: number;
  /**
   * Columns to use instead of the computed ones, for the nodes named here (T-0702:
   * a data store sits in the column of the process that touches it). The value is
   * the column number, rounded and at least 0; nodes not named, and ids that are
   * not nodes, are ranked as always. The result's `rank` reports the column
   * actually used. Without it nothing changes.
   */
  ranks?: ReadonlyMap<string, number>;
}

export interface LayeredNode {
  rank: number;
  row: string;
  /** Centre. */
  cx: number;
  cy: number;
}

export interface LayerLayoutResult {
  rank: Map<string, number>;
  back: boolean[];
  nodes: Map<string, LayeredNode>;
  /** Rows with their top edge and height; every row is listed, used or not. */
  rows: { key: string; y: number; height: number }[];
  /** Columns with their left edge and width. */
  columns: { rank: number; x: number; width: number }[];
}

export const LAYER_COLUMN_GAP = 56;
export const LAYER_SLOT_GAP = 16;
export const LAYER_ROW_PAD = 20;
export const LAYER_MIN_ROW_HEIGHT = 96;

/**
 * Places nodes in columns by rank and in rows by key.
 *
 * Two nodes sharing a column and a row stack inside that cell, in input order,
 * centred on the row's middle. A row grows to the tallest cell it holds. The
 * result depends only on the input, so adding an arrow elsewhere never moves
 * a node that was not involved.
 */
export function layerLayout(
  nodes: LayerNodeInput[],
  edges: RankEdge[],
  options: LayerLayoutOptions,
): LayerLayoutResult {
  const rowKeys = options.rows.length ? options.rows : [""];
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const columnGap = options.columnGap ?? LAYER_COLUMN_GAP;
  const slotGap = options.slotGap ?? LAYER_SLOT_GAP;
  const rowPad = options.rowPad ?? LAYER_ROW_PAD;
  const minRowHeight = options.minRowHeight ?? LAYER_MIN_ROW_HEIGHT;

  const { rank, back } = rankNodes(
    nodes.map((n) => n.id),
    edges,
  );
  if (options.ranks) {
    for (const n of nodes) {
      const given = options.ranks.get(n.id);
      if (given !== undefined && Number.isFinite(given)) rank.set(n.id, Math.max(0, Math.round(given)));
    }
  }
  const rowOf = (n: LayerNodeInput) => (rowKeys.includes(n.row) ? n.row : rowKeys[0]);

  // Columns: as wide as their widest node.
  const maxRank = Math.max(-1, ...nodes.map((n) => rank.get(n.id) ?? 0));
  const columns: LayerLayoutResult["columns"] = [];
  let x = originX;
  for (let r = 0; r <= maxRank; r++) {
    const width = Math.max(0, ...nodes.filter((n) => rank.get(n.id) === r).map((n) => n.width));
    columns.push({ rank: r, x, width });
    x += width + columnGap;
  }

  // Cells: the nodes of one (rank, row), in input order.
  const cells = new Map<string, LayerNodeInput[]>();
  for (const n of nodes) {
    const key = `${rank.get(n.id)}\u0000${rowOf(n)}`;
    const cell = cells.get(key);
    if (cell) cell.push(n);
    else cells.set(key, [n]);
  }
  const cellHeight = (cell: LayerNodeInput[]) =>
    cell.reduce((sum, n) => sum + n.height, 0) + slotGap * (cell.length - 1);

  // Rows: as tall as their fullest cell.
  const rows: LayerLayoutResult["rows"] = [];
  let y = originY;
  for (const key of rowKeys) {
    let tallest = 0;
    for (const [cellKey, cell] of cells) {
      if (cellKey.endsWith(`\u0000${key}`)) tallest = Math.max(tallest, cellHeight(cell));
    }
    const height = Math.max(minRowHeight, tallest + rowPad * 2);
    rows.push({ key, y, height });
    y += height;
  }

  const placed = new Map<string, LayeredNode>();
  for (const [cellKey, cell] of cells) {
    const [rankText, rowKey] = cellKey.split("\u0000");
    const column = columns[Number(rankText)];
    const row = rows.find((r) => r.key === rowKey)!;
    let top = row.y + row.height / 2 - cellHeight(cell) / 2;
    for (const n of cell) {
      placed.set(n.id, {
        rank: Number(rankText),
        row: rowKey,
        cx: column.x + column.width / 2,
        cy: top + n.height / 2,
      });
      top += n.height + slotGap;
    }
  }
  return { rank, back, nodes: placed, rows, columns };
}

// ---------------------------------------------------------------------------
// vertical layout (T-0697): rows are ranks, columns are branches
// ---------------------------------------------------------------------------

export interface ColumnNodeInput {
  id: string;
  width: number;
  height: number;
}

export interface ColumnLayoutOptions {
  /** Left edge of the leftmost column. */
  originX?: number;
  /** Top edge of the first row. */
  originY?: number;
  /** Space between two columns. */
  columnGap?: number;
  /** Space between two rows. */
  rowGap?: number;
}

export interface ColumnPlacedNode {
  /** Row: the node's rank. */
  rank: number;
  /** Branch column: 0 is the main line; new ones are 1, -1, 2, -2, ... as they appear. */
  column: number;
  /** Centre. */
  cx: number;
  cy: number;
}

export interface ColumnLayoutResult {
  rank: Map<string, number>;
  back: boolean[];
  nodes: Map<string, ColumnPlacedNode>;
  /** Rows, top to bottom, with their top edge and height. */
  rows: { rank: number; y: number; height: number }[];
  /** Columns, left to right, with their left edge and width. */
  columns: { column: number; x: number; width: number }[];
}

export const COLUMN_LAYOUT_COLUMN_GAP = 72;
export const COLUMN_LAYOUT_ROW_GAP = 48;

/**
 * Places nodes top to bottom by rank, with branches in side columns, for a
 * program flow chart (T-0697). `layerLayout` is untouched: this is the
 * vertical counterpart, not a mode of it.
 *
 * - **Row** = the node's rank (`rankNodes`: longest path, loops ignored). A row
 *   is as tall as its tallest node, plus `rowGap` between rows.
 * - **Column**: nodes nothing flows into are roots, taken in input order; each
 *   walks depth first along its arrows in the order they were written, never
 *   along a loop's return arrow. A root starts a column (the first at 0, the
 *   next ones at the right end). Of the not yet placed children of a node, the
 *   first stays in the parent's column (the main line runs straight down),
 *   the second opens a new column at the right end, the third one at the left
 *   end, the fourth at the right again, and so on. A child that is already
 *   placed (a merge) stays where it is. A column is never reused, and in one
 *   column every node follows the one before it by a forward arrow, so two
 *   nodes never share a row and a column.
 * - **Coordinates**: a column is as wide as its widest node; the columns run
 *   left to right by column number, `columnGap` apart.
 *
 * Only the input decides the result. A node pinned by hand (`@x,y`) is not
 * handled here: the caller overlays it, and the others keep their places.
 */
export function rankColumnLayout(
  nodes: ColumnNodeInput[],
  edges: RankEdge[],
  options: ColumnLayoutOptions = {},
): ColumnLayoutResult {
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const columnGap = options.columnGap ?? COLUMN_LAYOUT_COLUMN_GAP;
  const rowGap = options.rowGap ?? COLUMN_LAYOUT_ROW_GAP;

  const ids = nodes.map((n) => n.id);
  const { rank, back } = rankNodes(ids, edges);

  // Forward arrows between known, distinct nodes, in written order.
  const known = new Set(ids);
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const hasParent = new Set<string>();
  edges.forEach((e, i) => {
    if (back[i] || e.from === e.to || !known.has(e.from) || !known.has(e.to)) return;
    children.get(e.from)!.push(e.to);
    hasParent.add(e.to);
  });

  const column = new Map<string, number>();
  let minColumn = 0;
  let maxColumn = -1;
  const newRight = () => ++maxColumn;
  const newLeft = () => --minColumn;
  const visit = (id: string) => {
    let opened = 0;
    for (const child of children.get(id) ?? []) {
      if (column.has(child)) continue;
      if (opened === 0) column.set(child, column.get(id)!);
      else if (opened % 2 === 1) column.set(child, newRight());
      else column.set(child, newLeft());
      opened++;
      visit(child);
    }
  };
  const start = (id: string) => {
    if (column.has(id)) return;
    column.set(id, newRight());
    visit(id);
  };
  for (const id of ids) if (!hasParent.has(id)) start(id);
  for (const id of ids) start(id); // unreachable leftovers, defensively

  const columnKeys = [...new Set(column.values())].sort((a, b) => a - b);
  const width = (key: number) =>
    Math.max(0, ...nodes.filter((n) => column.get(n.id) === key).map((n) => n.width));
  const columns: ColumnLayoutResult["columns"] = [];
  let x = originX;
  for (const key of columnKeys) {
    const w = width(key);
    columns.push({ column: key, x, width: w });
    x += w + columnGap;
  }

  const maxRank = Math.max(-1, ...ids.map((id) => rank.get(id) ?? 0));
  const rows: ColumnLayoutResult["rows"] = [];
  let y = originY;
  for (let r = 0; r <= maxRank; r++) {
    const height = Math.max(0, ...nodes.filter((n) => rank.get(n.id) === r).map((n) => n.height));
    rows.push({ rank: r, y, height });
    y += height + rowGap;
  }

  const placed = new Map<string, ColumnPlacedNode>();
  for (const n of nodes) {
    const col = columns.find((c) => c.column === column.get(n.id))!;
    const row = rows[rank.get(n.id) ?? 0];
    placed.set(n.id, {
      rank: row.rank,
      column: col.column,
      cx: col.x + col.width / 2,
      cy: row.y + row.height / 2,
    });
  }
  return { rank, back, nodes: placed, rows, columns };
}

// ---------------------------------------------------------------------------
// Ring layout (T-0705): systems in a row at the centre, people and external
// services on an ellipse around them. For the use case diagram.
// ---------------------------------------------------------------------------

/** Which side of a person its speech bubble sits on (always the outer side). */
export type RingBubbleSide = "left" | "right" | "top" | "bottom";

export interface RingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A system: a big box in the middle row. */
export interface RingSystemInput {
  id: string;
  width: number;
  height: number;
}

/** A person or an external service: one place on the ring. */
export interface RingItemInput {
  id: string;
  width: number;
  height: number;
  /** Size of the speech bubble (people with something to do). Absent, or a
   * zero size, means no bubble. */
  bubble?: { width: number; height: number };
}

export interface RingLayoutOptions {
  /** Left and top of the whole drawing (bubbles included). Default 40. */
  originX?: number;
  originY?: number;
  /** Space between neighbouring systems. Default 48. */
  systemGap?: number;
  /** Least clearance between two cells (a cell is a box plus its bubble). Default 24. */
  cellGap?: number;
  /** Least clearance between a cell and a system. Default 32. */
  systemClearance?: number;
  /** Space between a person and its bubble. Default 14. */
  bubbleGap?: number;
  /** Width over height of the ring. Default 1.4. */
  aspect?: number;
  /** Boxes fixed by hand (`@x,y`): centres. They take part in the ring as
   * everyone does and are moved to these centres afterwards. */
  pinned?: ReadonlyMap<string, { cx: number; cy: number }>;
}

export interface RingBubble extends RingBox {
  /** Side of the person the bubble sits on. */
  side: RingBubbleSide;
  /** Side of the bubble's box that carries the tail (faces the person). */
  tailSide: RingBubbleSide;
}

export interface RingLayoutResult {
  /** Centre of every system and item. */
  nodes: Map<string, { cx: number; cy: number }>;
  /** Bubble of every item that has one. */
  bubbles: Map<string, RingBubble>;
  /** Everything drawn: boxes and bubbles (the tail's 8px aside). */
  bounds: RingBox;
  /** Centre of the systems (the ring's centre), after pins. */
  center: { x: number; y: number };
  /** Radii of the ring that was chosen (0 when nothing is on it). */
  rx: number;
  ry: number;
  /** How far the ring had to grow from its smallest size (1 = not at all). */
  scale: number;
}

export const RING_ORIGIN = 40;
export const RING_SYSTEM_GAP = 48;
export const RING_CELL_GAP = 24;
export const RING_SYSTEM_CLEARANCE = 32;
export const RING_BUBBLE_GAP = 14;
export const RING_ASPECT = 1.4;
const RING_GROWTH = 1.08;
const RING_MAX_STEPS = 40;

/**
 * The outer side a bubble goes on for a person at (`dx`, `dy`) from the ring's
 * centre: left or right when the person lies more across than up or down
 * (`|dx| >= |dy|`), otherwise top or bottom.
 */
export function ringBubbleSide(dx: number, dy: number): RingBubbleSide {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** The side of a bubble's box that faces the person it sits on `side` of. */
export function ringTailSide(side: RingBubbleSide): RingBubbleSide {
  const opposite: Record<RingBubbleSide, RingBubbleSide> = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
  };
  return opposite[side];
}

/** The bubble's box: `gap` away from `box` on `side`, centred on it. */
export function ringBubbleBox(
  box: RingBox,
  bubble: { width: number; height: number },
  side: RingBubbleSide,
  gap: number,
): RingBox {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const size = { width: bubble.width, height: bubble.height };
  switch (side) {
    case "right":
      return { x: box.x + box.width + gap, y: cy - bubble.height / 2, ...size };
    case "left":
      return { x: box.x - gap - bubble.width, y: cy - bubble.height / 2, ...size };
    case "bottom":
      return { x: cx - bubble.width / 2, y: box.y + box.height + gap, ...size };
    default:
      return { x: cx - bubble.width / 2, y: box.y - gap - bubble.height, ...size };
  }
}

/** Clearance between two boxes: positive when apart (the larger of the two
 * axis gaps), negative when they overlap. */
export function ringClearance(a: RingBox, b: RingBox): number {
  return Math.max(
    a.x - (b.x + b.width),
    b.x - (a.x + a.width),
    a.y - (b.y + b.height),
    b.y - (a.y + a.height),
  );
}

function ringUnion(a: RingBox, b: RingBox): RingBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

const ringRound = (n: number) => Math.round(n * 100) / 100;

/**
 * Places systems in the middle and everything else on a ring around them.
 *
 * - **Systems**: one row in input order, `systemGap` apart, centre lines
 *   level. Their bounding box's centre is the ring's centre `C`. No systems:
 *   `C` is a point and the ring is drawn around nothing.
 * - **Ring order**: the items in input order; item `i` of `n` sits at angle
 *   `-90deg + 360deg * i / n`, from 12 o'clock clockwise.
 * - **Ring size**: an ellipse `aspect : 1`. It starts at the size that lets
 *   the largest box (bubbles do not count: they sit on the outer side) clear
 *   the systems by `systemClearance` and grows 8% at a time (at most 40
 *   times) until every two cells are `cellGap` apart and every cell is
 *   `systemClearance` from every system. A cell is an item's box together
 *   with its bubble, so neither overlaps another person, another bubble or a
 *   system. The result depends on the input alone.
 * - **Bubbles**: outside, on the side `ringBubbleSide` picks from the person's
 *   position (re-decided from the final position, so a person moved by a pin
 *   still has its bubble on the outer side), `bubbleGap` away, centred.
 * - **Origin**: the whole drawing is shifted so its top left is at the origin.
 *   Pinned centres are applied after that, as given.
 */
export function ringLayout(
  systems: RingSystemInput[],
  items: RingItemInput[],
  options: RingLayoutOptions = {},
): RingLayoutResult {
  const originX = options.originX ?? RING_ORIGIN;
  const originY = options.originY ?? RING_ORIGIN;
  const systemGap = options.systemGap ?? RING_SYSTEM_GAP;
  const cellGap = options.cellGap ?? RING_CELL_GAP;
  const sysClear = options.systemClearance ?? RING_SYSTEM_CLEARANCE;
  const bubbleGap = options.bubbleGap ?? RING_BUBBLE_GAP;
  const aspect = options.aspect ?? RING_ASPECT;
  const pinned = options.pinned ?? new Map<string, { cx: number; cy: number }>();

  // Systems: a row on y = 0 starting at x = 0.
  const sysBoxes: RingBox[] = [];
  let sx = 0;
  for (const s of systems) {
    sysBoxes.push({ x: sx, y: -s.height / 2, width: s.width, height: s.height });
    sx += s.width + systemGap;
  }
  const rowWidth = systems.length > 0 ? sx - systemGap : 0;
  const rowHeight = Math.max(0, ...systems.map((s) => s.height));
  const cx0 = rowWidth / 2;
  const cy0 = 0;

  const n = items.length;
  const hasBubble = (it: RingItemInput) => !!it.bubble && it.bubble.width > 0 && it.bubble.height > 0;
  // The direction of item i from the centre does not depend on the ring's
  // size, so the side of its bubble does not either.
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
  const sideOf = (i: number) => ringBubbleSide(aspect * Math.cos(angle(i)), Math.sin(angle(i)));
  const cellOf = (it: RingItemInput, side: RingBubbleSide, x: number, y: number): RingBox => {
    const box = { x: x - it.width / 2, y: y - it.height / 2, width: it.width, height: it.height };
    return hasBubble(it) ? ringUnion(box, ringBubbleBox(box, it.bubble!, side, bubbleGap)) : box;
  };

  // Smallest ring: the largest person clears the systems by `systemClearance`. A
  // bubble sits on the outer side, so it never narrows the gap to the middle and
  // does not belong in this estimate (T-0706: counting it left a person with a
  // big bubble a hundred pixels from the system); the loop below grows the ring
  // when a bubble does crowd a neighbour.
  let maxHW = 0;
  let maxHH = 0;
  for (const it of items) {
    maxHW = Math.max(maxHW, it.width / 2);
    maxHH = Math.max(maxHH, it.height / 2);
  }
  const rx0 = Math.max(
    rowWidth / 2 + maxHW + sysClear,
    aspect * (rowHeight / 2 + maxHH + sysClear),
  );
  const ry0 = rx0 / aspect;

  const place = (k: number) =>
    items.map((_, i) => ({
      x: cx0 + k * rx0 * Math.cos(angle(i)),
      y: cy0 + k * ry0 * Math.sin(angle(i)),
    }));
  const fits = (k: number): boolean => {
    const at = place(k);
    const cells = items.map((it, i) => cellOf(it, sideOf(i), at[i].x, at[i].y));
    for (let i = 0; i < cells.length; i++) {
      for (const s of sysBoxes) if (ringClearance(cells[i], s) < sysClear) return false;
      for (let j = i + 1; j < cells.length; j++) {
        if (ringClearance(cells[i], cells[j]) < cellGap) return false;
      }
    }
    return true;
  };
  let k = 1;
  if (n > 0) for (let step = 0; step < RING_MAX_STEPS && !fits(k); step++) k *= RING_GROWTH;

  // Positions before the shift.
  const at = n > 0 ? place(k) : [];
  const centres = new Map<string, { cx: number; cy: number }>();
  systems.forEach((s, i) => centres.set(s.id, { cx: sysBoxes[i].x + s.width / 2, cy: 0 }));
  items.forEach((it, i) => centres.set(it.id, { cx: at[i].x, cy: at[i].y }));

  let minX = Infinity;
  let minY = Infinity;
  const take = (b: RingBox) => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  };
  sysBoxes.forEach(take);
  items.forEach((it, i) => take(cellOf(it, sideOf(i), at[i].x, at[i].y)));
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  const shiftX = originX - minX;
  const shiftY = originY - minY;

  const nodes = new Map<string, { cx: number; cy: number }>();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const s of systems) sizes.set(s.id, s);
  for (const it of items) sizes.set(it.id, it);
  for (const [id, c] of centres) {
    const pin = pinned.get(id);
    nodes.set(
      id,
      pin ? { cx: pin.cx, cy: pin.cy } : { cx: ringRound(c.cx + shiftX), cy: ringRound(c.cy + shiftY) },
    );
  }

  // The centre after pins: of the systems' bounding box (the ring's own when none).
  let center = { x: ringRound(cx0 + shiftX), y: ringRound(cy0 + shiftY) };
  if (systems.length > 0) {
    let l = Infinity;
    let r = -Infinity;
    let t = Infinity;
    let b = -Infinity;
    for (const s of systems) {
      const c = nodes.get(s.id)!;
      l = Math.min(l, c.cx - s.width / 2);
      r = Math.max(r, c.cx + s.width / 2);
      t = Math.min(t, c.cy - s.height / 2);
      b = Math.max(b, c.cy + s.height / 2);
    }
    center = { x: ringRound((l + r) / 2), y: ringRound((t + b) / 2) };
  }

  const bubbles = new Map<string, RingBubble>();
  for (const it of items) {
    if (!hasBubble(it)) continue;
    const c = nodes.get(it.id)!;
    const side = ringBubbleSide(c.cx - center.x, c.cy - center.y);
    const box = { x: c.cx - it.width / 2, y: c.cy - it.height / 2, width: it.width, height: it.height };
    const bb = ringBubbleBox(box, it.bubble!, side, bubbleGap);
    bubbles.set(it.id, {
      x: ringRound(bb.x),
      y: ringRound(bb.y),
      width: bb.width,
      height: bb.height,
      side,
      tailSide: ringTailSide(side),
    });
  }

  let bounds: RingBox | null = null;
  const grow = (b: RingBox) => {
    bounds = bounds ? ringUnion(bounds, b) : b;
  };
  for (const [id, c] of nodes) {
    const sz = sizes.get(id)!;
    grow({ x: c.cx - sz.width / 2, y: c.cy - sz.height / 2, width: sz.width, height: sz.height });
  }
  for (const b of bubbles.values()) grow(b);

  return {
    nodes,
    bubbles,
    bounds: bounds ?? { x: originX, y: originY, width: 0, height: 0 },
    center,
    rx: n > 0 ? ringRound(k * rx0) : 0,
    ry: n > 0 ? ringRound(k * ry0) : 0,
    scale: k,
  };
}
