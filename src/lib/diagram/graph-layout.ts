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
