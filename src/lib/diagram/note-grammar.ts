/**
 * The note grammar every node-and-edge Kind shares (T-1219).
 *
 * A Diagram note is Markdown a human also edits in Obsidian, so reading is
 * forgiving and writing is conservative:
 *
 * - A line the grammar does not recognize is **kept, not dropped**: it comes
 *   back as a raw line, is written back verbatim after the recognized ones, and
 *   the editor counts it as a warning.
 * - Only the sections a Kind manages are rewritten. The rest of the
 *   frontmatter, `## Memo` and every unknown section are carried through
 *   byte for byte, in the file's own line ending.
 *
 * This module holds the part of that contract that does not depend on the
 * Kind: the envelope (title, stickies, line endings, `updated`), the list-line
 * grammar (`- <id> title <modifiers>` with indented continuation lines), id
 * repair, the arrow section, and the pieces of a line written back. A Kind
 * (`<kind>/parse.ts`) supplies what is its own - its id prefixes, its
 * modifiers and their order, what a continuation line means, which arrows may
 * exist - and assembles its document model from the results. The model, the
 * Kind's public functions and the file format stay the Kind's.
 */
import { detectEol, toLf, withEol } from "../note-eol";
import { COLORS, type Color } from "./colors";
import { formatEdgeEnd, parseEdgeEnd } from "./edge-ports";
import type { EdgePort } from "./node-edge";
import {
  formatId,
  frontmatterValue,
  isContinuation,
  setFrontmatterValue,
  setOrRemoveFrontmatterValue,
} from "./note";
import { replaceSections, sectionText, splitNote, type SplitNote } from "./sections";
import { formatStickySection, parseStickies, strayStickies, type Sticky } from "./sticky";

export const INDENT = "  ";
/** Any `X-123` shaped id: another Kind's element, which a note keeps but does not read. */
const ANY_ID_RE = /^[A-Z]{1,3}-\d+$/;

// ---------------------------------------------------------------------------
// the envelope
// ---------------------------------------------------------------------------

export interface NoteEnvelope {
  /** The note split into frontmatter and sections, line endings normalized to LF. */
  note: SplitNote;
  /** `title` from the frontmatter; `fallbackTitle` (usually the file name) when absent. */
  title: string;
  /** `stickies: hidden` from the frontmatter. */
  stickiesHidden: boolean;
}

/**
 * Opens a note for reading. Line-oriented patterns end in `(.*)$`, which a
 * `\r` breaks, so the file's line ending is dealt with once, here.
 */
export function readEnvelope(content: string, fallbackTitle: string): NoteEnvelope {
  const note = splitNote(toLf(content));
  return {
    note,
    title: frontmatterValue(note.frontmatter, "title") || fallbackTitle,
    stickiesHidden: frontmatterValue(note.frontmatter, "stickies") === "hidden",
  };
}

export interface StickyRead {
  stickies: Sticky[];
  /** Lines under `## Stickies` the grammar did not recognize, kept verbatim. */
  rawStickies: string[];
  /** True when an id had to be minted. */
  minted: boolean;
}

export function readStickies(note: SplitNote): StickyRead {
  const parsed = parseStickies(sectionText(note, "Stickies"));
  return { stickies: parsed.stickies, rawStickies: parsed.raw, minted: parsed.minted };
}

/** The non-blank lines of a section, without its heading line. */
export function bodyLines(section: string): string[] {
  return section
    .split("\n")
    .filter((line, i) => !(i === 0 && /^##\s+/.test(line)) && line.trim() !== "");
}

// ---------------------------------------------------------------------------
// the list-line grammar
// ---------------------------------------------------------------------------

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const POSITION_RE = new RegExp(`^@(${NUMBER}),(${NUMBER})$`);

/** `@x,y` as whole pixels, or `undefined` for anything else (a malformed `@` stays in the title). */
export function positionModifier(token: string): { x: number; y: number } | undefined {
  const m = POSITION_RE.exec(token);
  return m ? { x: Math.round(Number(m[1])), y: Math.round(Number(m[2])) } : undefined;
}

export function colorModifier(token: string): Color | undefined {
  return token.startsWith("#") && (COLORS as readonly string[]).includes(token.slice(1))
    ? (token.slice(1) as Color)
    : undefined;
}

/** `<prefix>value` with a non-empty value, e.g. `task:T-0100`, `lane:L-001`. */
export function prefixModifier(prefix: string): (token: string) => string | undefined {
  return (token) =>
    token.startsWith(prefix) && token.length > prefix.length ? token.slice(prefix.length) : undefined;
}

export const taskModifier = prefixModifier("task:");

/** One reader per field a line may carry; it returns the field's value or `undefined` when the token is not that field. */
export type Modifiers<F> = { [K in keyof F]-?: (token: string) => F[K] | undefined };

/**
 * Reads the tokens after an id. Modifiers may appear in any order and the first
 * of each field wins; every other token - an unknown `^word`, an unrecognized
 * `#word`, a malformed `@`, a second value of a field - is part of the title.
 */
export function readModifiers<F>(
  tokens: readonly string[],
  modifiers: Modifiers<F>,
): { fields: Partial<F>; title: string } {
  const fields: Partial<F> = {};
  const title: string[] = [];
  const names = Object.keys(modifiers) as (keyof F)[];
  for (const token of tokens) {
    let taken = false;
    for (const name of names) {
      if (name in fields) continue;
      const value = modifiers[name](token);
      if (value !== undefined) {
        fields[name] = value;
        taken = true;
        break;
      }
    }
    if (!taken) title.push(token);
  }
  return { fields, title: title.join(" ") };
}

export interface ElementLine {
  /** The id the line carried; empty when it had none. */
  id: string;
  /** The tokens after the id. */
  rest: string[];
}

/**
 * Splits a list line into its id and the tokens after it. `null` for a line
 * that is not a list item, and for one that starts with the id of something
 * `ownId` does not accept: not this note's to read or renumber.
 */
export function splitElementLine(line: string, ownId: (token: string) => boolean): ElementLine | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  if (ownId(tokens[0])) return { id: tokens[0], rest: tokens.slice(1) };
  if (ANY_ID_RE.test(tokens[0])) return null;
  return { id: "", rest: tokens };
}

export interface ElementSpec<E extends { id: string; note?: string }> {
  /** True for an id of this section (`F-001`). */
  ownId(token: string): boolean;
  /** Builds an element from its id (empty when missing) and the tokens after it. */
  build(id: string, rest: string[]): E;
  /**
   * What the indented lines under an element are: `"note"` (the default) joins
   * them into `note`; `"none"` means there are none, so such a line is kept raw;
   * a function takes each line (trimmed) and files it as the Kind sees fit.
   */
  continuation?: "note" | "none" | ((element: E, text: string) => void);
  /** The id prefix a missing or duplicate id is minted under. */
  mintPrefix: string | ((element: E) => string);
}

export interface ElementsRead<E> {
  items: E[];
  /** Lines the grammar did not recognize, kept verbatim. */
  raw: string[];
  /** True when an id had to be minted. */
  minted: boolean;
}

/** Reads the element lines of one section, mints missing ids and repairs duplicates. */
export function readElements<E extends { id: string; note?: string }>(
  section: string,
  spec: ElementSpec<E>,
): ElementsRead<E> {
  const items: E[] = [];
  const raw: string[] = [];
  const notes = new Map<E, string[]>();
  const continuation = spec.continuation ?? "note";
  let open: E | null = null;
  for (const line of bodyLines(section)) {
    const parsed = splitElementLine(line, spec.ownId);
    if (parsed) {
      open = spec.build(parsed.id, parsed.rest);
      items.push(open);
      continue;
    }
    if (open && continuation !== "none" && isContinuation(line)) {
      if (typeof continuation === "function") {
        continuation(open, line.trim());
      } else {
        const collected = notes.get(open);
        if (collected) collected.push(line.trim());
        else notes.set(open, [line.trim()]);
      }
      continue;
    }
    open = null;
    raw.push(line.trimEnd());
  }
  for (const [item, collected] of notes) item.note = collected.join("\n");
  const minted = assignMissingIds(items, spec.mintPrefix);
  return { items, raw, minted };
}

/**
 * Gives every id-less element an id and repairs duplicates. Numbers are per
 * prefix: the highest in the file plus one, so ids are never reused. Returns
 * whether anything was minted.
 */
export function assignMissingIds<E extends { id: string }>(
  items: E[],
  prefix: string | ((item: E) => string),
): boolean {
  const max = new Map<string, number>();
  for (const item of items) {
    const m = /^([A-Z]{1,3})-(\d+)$/.exec(item.id);
    if (m) max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
  }
  const seen = new Set<string>();
  let minted = false;
  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      const p = typeof prefix === "function" ? prefix(item) : prefix;
      const n = (max.get(p) ?? 0) + 1;
      max.set(p, n);
      item.id = formatId(p, n);
      minted = true;
    }
    seen.add(item.id);
  }
  return minted;
}

export function findById<T extends { id: string }>(items: readonly T[], id: string): T | null {
  return items.find((item) => item.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// arrows
// ---------------------------------------------------------------------------

export interface ArrowShape {
  from: string;
  to: string;
  label?: string;
  fromPort?: EdgePort;
  toPort?: EdgePort;
}

/**
 * Reads `- A-001 -> A-002`, with the pinned ends of `edge-ports.ts` and, when
 * `label` is true, a trailing `"label"`. `null` for anything else (a Kind
 * without labels keeps a labelled line raw).
 */
export function readArrowLine(line: string, options: { label: boolean }): ArrowShape | null {
  const re = options.label
    ? /^\s*-\s+(\S+)\s*->\s*(\S+)\s*(?:"(.*)")?\s*$/
    : /^\s*-\s+(\S+)\s*->\s*(\S+)\s*$/;
  const m = re.exec(line);
  if (!m) return null;
  const from = parseEdgeEnd(m[1]);
  const to = parseEdgeEnd(m[2]);
  if (!from || !to) return null;
  const label = (m[3] ?? "").trim();
  return {
    from: from.id,
    to: to.id,
    ...(label ? { label } : {}),
    ...(from.port ? { fromPort: from.port } : {}),
    ...(to.port ? { toPort: to.port } : {}),
  };
}

export interface EdgeSpec<E extends { from: string; to: string; label?: string }> {
  /** Reads one line, or `null` when it is not an edge of this Kind. */
  parse(line: string): E | null;
  /** True when `existing` already joins the pair `incoming` names. */
  isTwin(existing: E, incoming: E): boolean;
  /**
   * What a second line for a pair already joined does: `"merge-label"` is one
   * arrow (the first stays, taking the later label only if it has none);
   * `"keep-raw"` keeps the later line as a raw line, and so warns.
   */
  onTwin: "merge-label" | "keep-raw";
  /** A further rule an edge must meet (a connection rule), beyond both ends existing. */
  accepts?(edge: E): boolean;
}

export interface EdgesRead<E> {
  edges: E[];
  raw: string[];
}

/** Reads the edge lines of one section. An edge is real only between two elements that exist. */
export function readEdges<E extends { from: string; to: string; label?: string }>(
  section: string,
  ids: ReadonlySet<string>,
  spec: EdgeSpec<E>,
): EdgesRead<E> {
  const edges: E[] = [];
  const raw: string[] = [];
  for (const line of bodyLines(section)) {
    const edge = spec.parse(line);
    if (
      !edge ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      (spec.accepts && !spec.accepts(edge))
    ) {
      raw.push(line.trimEnd());
      continue;
    }
    const twin = edges.find((e) => spec.isTwin(e, edge));
    if (!twin) {
      edges.push(edge);
    } else if (spec.onTwin === "keep-raw") {
      raw.push(line.trimEnd());
    } else if (!twin.label && edge.label) {
      twin.label = edge.label;
    }
  }
  return { edges, raw };
}

/** The pair an arrow joins, in order: what `->` is identified by. */
export function sameOrderedPair(a: { from: string; to: string }, b: { from: string; to: string }): boolean {
  return a.from === b.from && a.to === b.to;
}

/** The edges once per pair (the first line wins), whatever the model holds. */
export function uniqueEdges<E>(edges: readonly E[], isTwin: (existing: E, incoming: E) => boolean): E[] {
  const out: E[] = [];
  for (const edge of edges) if (!out.some((e) => isTwin(e, edge))) out.push(edge);
  return out;
}

// ---------------------------------------------------------------------------
// warnings
// ---------------------------------------------------------------------------

/**
 * How many lines the note keeps but the editor cannot show: unreadable lines in
 * any section, and stickies whose element is gone.
 */
export function countWarnings(
  raws: readonly (readonly string[])[],
  stickies: readonly Sticky[],
  targetIds: ReadonlySet<string>,
): number {
  return raws.reduce((n, raw) => n + raw.length, 0) + strayStickies([...stickies], new Set(targetIds)).length;
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/** One line of text with no newline in it (a stray one would end the line early and leave an unparsable second). */
export function firstLine(text: string): string {
  return text.split("\n")[0].trim();
}

export function formatPosition(x: number | undefined, y: number | undefined): string | undefined {
  return x !== undefined && y !== undefined ? `@${Math.round(x)},${Math.round(y)}` : undefined;
}

export function formatColor(color: Color | undefined): string | undefined {
  return color ? `#${color}` : undefined;
}

export function formatTask(task: string | undefined): string | undefined {
  return task ? `task:${task}` : undefined;
}

/** `- <id> <title> <modifiers...>`; an empty title or modifier is left out. */
export function formatElementLine(
  id: string,
  title: string,
  modifiers: readonly (string | undefined)[],
): string {
  const parts = [id];
  const head = firstLine(title);
  if (head) parts.push(head);
  for (const m of modifiers) if (m) parts.push(m);
  return `- ${parts.join(" ")}`;
}

/** The note's lines, indented under their element. */
export function formatNoteLines(note: string | undefined): string[] {
  const text = (note ?? "").replace(/\s+$/, "");
  return text ? text.split("\n").map((line) => `${INDENT}${line}`) : [];
}

/** An edge's label as the file carries it: the quotes around it could not hold one inside. */
export function formatLabel(label: string | undefined): string {
  const text = (label ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return text ? ` "${text}"` : "";
}

/** `- A-001 -> A-002 "label"`, with pinned ends. */
export function formatArrowLine(edge: ArrowShape, withLabel: boolean): string {
  const label = withLabel ? formatLabel(edge.label) : "";
  return `- ${formatEdgeEnd(edge.from, edge.fromPort)} -> ${formatEdgeEnd(edge.to, edge.toPort)}${label}`;
}

/** A managed section as written: its recognized lines, then the raw ones. */
export function formatSection(name: string, lines: readonly string[]): string {
  const body = lines.join("\n");
  return body ? `## ${name}\n\n${body}\n\n` : `## ${name}\n\n`;
}

export interface NoteWrite {
  /** `stickies: hidden` is written, or removed when false. */
  stickiesHidden: boolean;
  /** The managed sections, in the order they are written (an absent one is placed by `replaceSections`). */
  sections: { name: string; text: string }[];
  /** Further frontmatter edits, applied after `updated` and before `stickies`. */
  frontmatter?: (frontmatter: string) => string;
}

/**
 * Renders a note back into `content`, replacing only the managed sections and
 * stamping `updated`. The file keeps the line ending it already had: it is
 * shared with Obsidian, with git and with the user's own editor.
 */
export function writeNote(content: string, today: string, write: NoteWrite): string {
  const eol = detectEol(content);
  const note = splitNote(toLf(content));
  let frontmatter = setFrontmatterValue(note.frontmatter, "updated", today);
  if (write.frontmatter) frontmatter = write.frontmatter(frontmatter);
  frontmatter = setOrRemoveFrontmatterValue(frontmatter, "stickies", write.stickiesHidden ? "hidden" : "");
  return withEol(replaceSections({ ...note, frontmatter }, write.sections), eol);
}

/** The `## Stickies` section as written, for a Kind's `sections` list. */
export function stickySection(stickies: Sticky[], raw: string[]): { name: string; text: string } {
  return { name: "Stickies", text: formatStickySection(stickies, raw) };
}
