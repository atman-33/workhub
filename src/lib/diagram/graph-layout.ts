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
