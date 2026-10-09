/**
 * 2x2 matrix note <-> document model (T-0681).
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative - the same contract as the Mindmap note:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. A line
 *   under `## Items` that is not a readable item (not a list item, or one with
 *   an id of another kind) survives as a raw line and is written back verbatim.
 * - Only `## Items` and `## Stickies` are rewritten. The rest of the
 *   frontmatter, `## Memo` and every unknown section are copied byte-for-byte.
 *
 * The grammar:
 *
 *   - M-001 <title> [@<x>,<y>] [#<color>] [task:<task-id>]
 *     <optional continuation lines, indented - the item's note>
 *
 * `@x,y` is the item's centre on the two axes, each 0 to 1 with at most two
 * decimals: x runs left 0 to right 1, y runs bottom 0 to top 1. An item with
 * no `@` is placed near the middle by the layout, and only gets one when the
 * user drags it.
 *
 * The axis and quadrant labels live in the frontmatter (`x_axis`, `x_low`,
 * `x_high`, `y_axis`, `y_low`, `y_high`, `q_tl`, `q_tr`, `q_bl`, `q_br`); an
 * empty one is simply not drawn.
 */
import { detectEol, toLf, withEol } from "../../note-eol";
import { COLORS, type Color } from "../colors";
import {
  formatId,
  frontmatterScalar,
  frontmatterValue,
  isContinuation,
  nextId,
  setFrontmatterValue,
  setOrRemoveFrontmatterValue,
  splitSections,
} from "../note";
import { formatStickySection, parseStickies, type Sticky } from "../sticky";

export const ITEM_PREFIX = "M";
const ITEM_ID_RE = /^M-\d+$/;
/** Any `X-123` shaped id: another kind's element, which this note keeps but
 * does not read. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;
const INDENT = "  ";

/** The ten label keys of the frontmatter, by the model field they fill. */
export const LABEL_KEYS = {
  xAxis: "x_axis",
  xLow: "x_low",
  xHigh: "x_high",
  yAxis: "y_axis",
  yLow: "y_low",
  yHigh: "y_high",
  qTl: "q_tl",
  qTr: "q_tr",
  qBl: "q_bl",
  qBr: "q_br",
} as const;
export type LabelField = keyof typeof LABEL_KEYS;
export const LABEL_FIELDS = Object.keys(LABEL_KEYS) as LabelField[];

export interface MatrixItem {
  /** Stable, file-unique id (`M-001`). Never reassigned and never reused. */
  id: string;
  title: string;
  /** Centre on the x axis, 0 (left) to 1 (right). Absent until placed. */
  x?: number;
  /** Centre on the y axis, 0 (bottom) to 1 (top). Absent until placed. */
  y?: number;
  color?: Color;
  /** Linked task id (`T-0684`). */
  task?: string;
  /** Continuation lines - shown on hover. */
  note?: string;
}

export interface MatrixDocModel extends Record<LabelField, string> {
  /** `title` from the frontmatter; the file name stands in when absent. */
  title: string;
  items: MatrixItem[];
  /** Lines under `## Items` the grammar did not recognize, kept verbatim. */
  rawItems: string[];
  /** True when parsing had to mint at least one id. */
  mintedIds: boolean;
  /** Sticky notes from `## Stickies`, in file order. */
  stickies: Sticky[];
  /** Lines under `## Stickies` the grammar did not recognize, kept verbatim. */
  rawStickies: string[];
  /** `stickies: hidden` from the frontmatter. */
  stickiesHidden: boolean;
}

// ---------------------------------------------------------------------------
// coordinates
// ---------------------------------------------------------------------------

/** Rounds to two decimals and clamps to 0..1. A non-finite value reads as the middle. */
export function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** `0.7` -> `0.70`, the form the file carries. */
export function formatUnit(n: number): string {
  return clampUnit(n).toFixed(2);
}

const NUMBER = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`;
const POSITION_RE = new RegExp(`^@(${NUMBER}),(${NUMBER})$`);

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

interface ParsedLine {
  item: MatrixItem;
  hadId: boolean;
}

/** `- M-001 タブの並び替え @0.20,0.85 #green task:T-0684` */
function parseItemLine(line: string): ParsedLine | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;

  const tokens = body.split(/\s+/).filter(Boolean);
  let id = "";
  let hadId = false;
  if (ITEM_ID_RE.test(tokens[0])) {
    id = tokens[0];
    hadId = true;
    tokens.shift();
  } else if (ANY_ID_RE.test(tokens[0])) {
    // Another kind's id (`N-001`, `F-002`): not this note's to read or renumber.
    return null;
  }

  let x: number | undefined;
  let y: number | undefined;
  let color: Color | undefined;
  let task: string | undefined;
  const titleTokens: string[] = [];
  // Modifiers may appear in any order; anything left over is the title. A
  // title is free text, so an unrecognized `#word` or a malformed `@` stays
  // part of it rather than being silently eaten.
  for (const tok of tokens) {
    const pos = POSITION_RE.exec(tok);
    if (pos && x === undefined) {
      x = clampUnit(Number(pos[1]));
      y = clampUnit(Number(pos[2]));
      continue;
    }
    if (tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1)) && !color) {
      color = tok.slice(1) as Color;
      continue;
    }
    if (tok.startsWith("task:") && tok.length > 5 && !task) {
      task = tok.slice(5);
      continue;
    }
    titleTokens.push(tok);
  }

  return {
    hadId,
    item: {
      id,
      title: titleTokens.join(" "),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
      ...(color ? { color } : {}),
      ...(task ? { task } : {}),
    },
  };
}

/** Parses a matrix note. `fallbackTitle` (usually the file name) stands in
 * when the frontmatter has no `title`. */
export function parseMatrix(content: string, fallbackTitle = ""): MatrixDocModel {
  // Everything below is line-oriented and several patterns end in `(.*)$`,
  // which `\r` breaks - so the file's line ending is dealt with once, here.
  const s = splitSections(toLf(content), "Items");
  const labels = Object.fromEntries(
    LABEL_FIELDS.map((field) => [field, frontmatterValue(s.frontmatter, LABEL_KEYS[field]).trim()]),
  ) as Record<LabelField, string>;
  const doc: MatrixDocModel = {
    ...labels,
    title: frontmatterValue(s.frontmatter, "title") || fallbackTitle,
    items: [],
    rawItems: [],
    mintedIds: false,
    stickies: [],
    rawStickies: [],
    stickiesHidden: frontmatterValue(s.frontmatter, "stickies") === "hidden",
  };

  const notes = new Map<MatrixItem, string[]>();
  let open: MatrixItem | null = null;
  for (const line of s.managed.split("\n")) {
    if (/^##\s+/.test(line)) continue; // the `## Items` heading itself
    if (!line.trim()) continue;

    const parsed = parseItemLine(line);
    if (parsed) {
      doc.items.push(parsed.item);
      if (!parsed.hadId) doc.mintedIds = true;
      open = parsed.item;
      continue;
    }
    if (open && isContinuation(line)) {
      const collected = notes.get(open);
      if (collected) collected.push(line.trim());
      else notes.set(open, [line.trim()]);
      continue;
    }
    open = null;
    doc.rawItems.push(line.trimEnd());
  }
  for (const [item, collected] of notes) item.note = collected.join("\n");

  assignMissingIds(doc);
  const stickies = parseStickies(s.stickies);
  doc.stickies = stickies.stickies;
  doc.rawStickies = stickies.raw;
  if (stickies.minted) doc.mintedIds = true;
  return doc;
}

/** Gives every id-less item an id, and repairs duplicates. */
function assignMissingIds(doc: MatrixDocModel): void {
  const seen = new Set<string>();
  let max = 0;
  for (const item of doc.items) {
    const n = /^M-(\d+)$/.exec(item.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  for (const item of doc.items) {
    if (!item.id || seen.has(item.id)) {
      max += 1;
      item.id = formatId(ITEM_PREFIX, max);
      doc.mintedIds = true;
    }
    seen.add(item.id);
  }
}

/** Next free `M-NNN` for this document. Ids are never reused. */
export function nextItemId(items: MatrixItem[]): string {
  return nextId(ITEM_PREFIX, items.map((i) => i.id));
}

export function findItem(items: MatrixItem[], id: string): MatrixItem | null {
  return items.find((i) => i.id === id) ?? null;
}

/** How many lines the note keeps but the editor cannot show: unreadable item
 * lines, and stickies whose item is gone. */
export function warningCount(doc: MatrixDocModel): number {
  const ids = new Set(doc.items.map((i) => i.id));
  return doc.rawItems.length + doc.stickies.filter((s) => !ids.has(s.targetId)).length;
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

/** Renders one item: its grammar line plus any note lines. */
export function formatItem(item: MatrixItem): string[] {
  const parts = [item.id];
  // Only ever the first line: a stray newline in the title would otherwise
  // emit a second, unparsable line.
  const title = item.title.split("\n")[0].trim();
  if (title) parts.push(title);
  if (item.x !== undefined && item.y !== undefined) {
    parts.push(`@${formatUnit(item.x)},${formatUnit(item.y)}`);
  }
  if (item.color) parts.push(`#${item.color}`);
  if (item.task) parts.push(`task:${item.task}`);

  const out = [`- ${parts.join(" ")}`];
  const note = (item.note ?? "").replace(/\s+$/, "");
  if (note) {
    for (const line of note.split("\n")) out.push(`${INDENT}${line}`);
  }
  return out;
}

/**
 * Renders the model back into `content`, replacing only `## Items` and
 * `## Stickies` and stamping `updated`. Unrecognized lines are appended after
 * the recognized ones so nothing is lost, and every other byte of the file is
 * carried through.
 */
export function serializeMatrix(content: string, doc: MatrixDocModel, today: string): string {
  // The file keeps the line ending it already had: this note is shared with
  // Obsidian, with git and with the user's own editor.
  const eol = detectEol(content);
  const s = splitSections(toLf(content), "Items");
  let frontmatter = setFrontmatterValue(s.frontmatter, "updated", today);
  for (const field of LABEL_FIELDS) {
    const key = LABEL_KEYS[field];
    // A label that was not edited is left exactly as the file spells it (its
    // quotes, its spacing); only a changed one is rewritten.
    if (frontmatterValue(frontmatter, key).trim() === doc[field].trim()) continue;
    frontmatter = setOrRemoveFrontmatterValue(frontmatter, key, frontmatterScalar(doc[field]));
  }
  frontmatter = setOrRemoveFrontmatterValue(frontmatter, "stickies", doc.stickiesHidden ? "hidden" : "");

  const body = [...doc.items.flatMap(formatItem), ...doc.rawItems].join("\n");
  const items = body ? `## Items\n\n${body}\n\n` : "## Items\n\n";
  const stickies = formatStickySection(doc.stickies, doc.rawStickies);

  let { preamble, tail } = s;
  if (!s.managed) {
    // A note with no `## Items` yet: the section goes in before `## Memo`, not
    // after it, or it would read as part of the memo.
    const memo = /^##\s+Memo\s*$/m.exec(preamble);
    if (memo) {
      tail = preamble.slice(memo.index);
      preamble = preamble.slice(0, memo.index);
    }
    // One blank line between what came before and the new section.
    if (preamble && !preamble.endsWith("\n\n")) {
      preamble += preamble.endsWith("\n") ? "\n" : "\n\n";
    }
  }
  return withEol(`${frontmatter}${preamble}${items}${s.between}${stickies}${tail}`, eol);
}
