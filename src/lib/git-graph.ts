/**
 * Pure, dependency-free lane-assignment algorithm for a SourceTree/Git-Graph
 * style commit graph.
 *
 * `computeGraphLayout` performs a single pass over commits given in
 * `--topo-order` (children always precede their parents) and assigns each
 * commit to a lane (column). Lanes are stored in a flat array indexed by
 * column; a `null` entry means the column is free. Columns are never
 * shifted/compacted — once a lane closes its column becomes available for
 * reuse by a later, unrelated branch tip.
 *
 * Rendering is expected to draw one small `<svg>` per row (`ROW_H` tall):
 * `edgesTop` connects the previous row's lane positions to this row's dot,
 * `edgesBottom` connects this row's dot to the next row's lane positions.
 * An edge is a straight vertical line when `fromCol === toCol`, otherwise a
 * curve between the two columns.
 */

export interface Lane {
  /** Hash of the commit this lane is currently waiting to reach. */
  hash: string;
  /** Color assigned to this lane for as long as it stays open. */
  color: string;
}

export interface Edge {
  fromCol: number;
  toCol: number;
  color: string;
}

export interface RowLayout {
  hash: string;
  /** Column the commit's dot is drawn in. */
  column: number;
  /** Color of the commit's dot (== the color of its lane). */
  color: string;
  /** Edges spanning the top half of the row (previous row -> this dot). */
  edgesTop: Edge[];
  /** Edges spanning the bottom half of the row (this dot -> next row). */
  edgesBottom: Edge[];
  /** Highest column index touched by this row (for sizing the row's SVG). */
  maxCol: number;
}

export const ROW_H = 28;
export const COL_W = 14;

/** 10 hex colors chosen to read clearly on both dark and light zinc UIs. */
export const PALETTE: readonly string[] = [
  "#f43f5e", // rose
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#84cc16", // lime
];

interface CommitInput {
  hash: string;
  parents: string[];
}

/** Finds the first free (null) slot in `lanes`, or appends a new one. */
function allocateSlot(lanes: (Lane | null)[]): number {
  const free = lanes.indexOf(null);
  if (free !== -1) return free;
  lanes.push(null);
  return lanes.length - 1;
}

export function computeGraphLayout(commits: CommitInput[]): RowLayout[] {
  const lanes: (Lane | null)[] = [];
  let paletteIndex = 0;
  const nextColor = (): string => PALETTE[paletteIndex++ % PALETTE.length];

  const rows: RowLayout[] = [];

  for (const commit of commits) {
    // Snapshot of active columns before this row touches anything, used to
    // compute pass-through edges (lanes unrelated to this commit that still
    // need to be drawn straight through the row).
    const preActiveCols: number[] = [];
    for (let c = 0; c < lanes.length; c++) {
      if (lanes[c] !== null) preActiveCols.push(c);
    }

    // Step 1: find every lane waiting for this commit's hash.
    const incomingCols = preActiveCols.filter(
      (c) => lanes[c]!.hash === commit.hash,
    );

    // Step 2: determine the dot's column + color.
    let dotCol: number;
    let dotColor: string;
    if (incomingCols.length > 0) {
      dotCol = Math.min(...incomingCols);
      dotColor = lanes[dotCol]!.color;
    } else {
      dotCol = allocateSlot(lanes);
      dotColor = nextColor();
      lanes[dotCol] = { hash: commit.hash, color: dotColor };
    }

    // Step 3: top-half edges — incoming curves/straights into the dot, plus
    // straight pass-throughs for every other still-active lane.
    const edgesTop: Edge[] = [];
    for (const c of incomingCols) {
      edgesTop.push({ fromCol: c, toCol: dotCol, color: lanes[c]!.color });
    }
    for (const c of preActiveCols) {
      if (c === dotCol || incomingCols.includes(c)) continue;
      edgesTop.push({ fromCol: c, toCol: c, color: lanes[c]!.color });
    }

    // Step 5 (release): every incoming lane other than the dot's own column
    // is now merged/consumed — free its column. Column indices never shift.
    for (const c of incomingCols) {
      if (c !== dotCol) lanes[c] = null;
    }

    // Step 4/6: bottom-half — attach parents.
    const edgesBottom: Edge[] = [];
    const bottomTouchedCols = new Set<number>([dotCol]);

    if (commit.parents.length === 0) {
      // Root commit: its lane closes here, nothing continues below.
      lanes[dotCol] = null;
    } else {
      const [firstParent, ...extraParents] = commit.parents;

      // First parent always continues the dot's own lane.
      lanes[dotCol] = { hash: firstParent, color: dotColor };
      edgesBottom.push({ fromCol: dotCol, toCol: dotCol, color: dotColor });

      // Extra parents (merge commits) join an existing waiting lane, or
      // allocate a brand-new one.
      for (const parentHash of extraParents) {
        const existingCol = lanes.findIndex(
          (lane, idx) =>
            lane !== null && lane.hash === parentHash && idx !== dotCol,
        );
        if (existingCol !== -1) {
          bottomTouchedCols.add(existingCol);
          edgesBottom.push({
            fromCol: dotCol,
            toCol: existingCol,
            color: lanes[existingCol]!.color,
          });
        } else {
          const newCol = allocateSlot(lanes);
          const newColor = nextColor();
          lanes[newCol] = { hash: parentHash, color: newColor };
          bottomTouchedCols.add(newCol);
          edgesBottom.push({
            fromCol: dotCol,
            toCol: newCol,
            color: newColor,
          });
        }
      }
    }

    // Bottom-half pass-throughs: lanes that were active before this row,
    // weren't consumed as incoming, and weren't touched by the parent
    // wiring above just continue straight down.
    for (const c of preActiveCols) {
      if (incomingCols.includes(c) || bottomTouchedCols.has(c)) continue;
      edgesBottom.push({ fromCol: c, toCol: c, color: lanes[c]!.color });
    }

    // Step 8: maxCol — highest column actually touched by this row, so
    // trailing free lanes never inflate the row's rendered width.
    const touchedCols = [
      dotCol,
      ...incomingCols,
      ...edgesTop.map((e) => Math.max(e.fromCol, e.toCol)),
      ...edgesBottom.map((e) => Math.max(e.fromCol, e.toCol)),
    ];
    const maxCol = touchedCols.length > 0 ? Math.max(...touchedCols) : 0;

    rows.push({
      hash: commit.hash,
      column: dotCol,
      color: dotColor,
      edgesTop,
      edgesBottom,
      maxCol,
    });
  }

  return rows;
}
