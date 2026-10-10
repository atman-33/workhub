/**
 * The per-quadrant notes of a 2x2 matrix (T-0692): the `## Quadrants` section.
 *
 *   ## Quadrants
 *
 *   - q_tl <first line of the note>
 *     <continuation lines, indented - blank lines and nested bullets included>
 *   - q_br <note>
 *
 * The keys are the frontmatter's quadrant label keys and tie the note to a
 * position, so renaming a quadrant never moves its note. Unlike an item's note,
 * a continuation here may itself start with `- `: only a `- q_xx` at column 0
 * opens a new entry, so nothing is ambiguous.
 *
 * Reading is forgiving, writing is conservative (the Items contract): a line
 * the grammar cannot place - an unknown key, a second entry for the same
 * quadrant (the first wins), a line that is not a list entry, text that is not
 * indented - is kept verbatim and written back after the notes.
 */

export type QuadrantKey = "tl" | "tr" | "bl" | "br";
/** The order the section is always written in. */
export const QUADRANT_KEYS: readonly QuadrantKey[] = ["tl", "tr", "bl", "br"];

export type QuadrantNotes = Record<QuadrantKey, string>;

export function emptyQuadrantNotes(): QuadrantNotes {
  return { tl: "", tr: "", bl: "", br: "" };
}

const INDENT = "  ";
const ENTRY_RE = /^-[ \t]+(\S+)(?:[ \t]+(.*))?$/;
const KEY_PREFIX = "q_";

/**
 * A note as the file will carry it: leading blank lines and trailing space go,
 * the first line loses its indentation, every line its trailing space. Inner
 * blank lines and the relative indentation of the lines are kept.
 */
export function normalizeQuadrantNote(note: string): string {
  const lines = note.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length) lines[0] = lines[0].replace(/^\s+/, "");
  return lines.join("\n");
}

export interface ParsedQuadrants {
  notes: QuadrantNotes;
  /** Lines the grammar did not place, verbatim and in file order. */
  raw: string[];
}

interface Block {
  key: QuadrantKey;
  first: string;
  rest: string[];
}

function isKey(token: string): token is `q_${QuadrantKey}` {
  return token.startsWith(KEY_PREFIX) && (QUADRANT_KEYS as readonly string[]).includes(token.slice(2));
}

function finishBlock(block: Block): string {
  // The continuation's common indentation is the file's business (2 spaces, 4
  // spaces, a tab): strip what all of its non-blank lines share.
  const body = block.rest.filter((l) => l.trim());
  const common = body.length ? Math.min(...body.map((l) => /^[ \t]*/.exec(l)![0].length)) : 0;
  const rest = block.rest.map((l) => (l.trim() ? l.slice(common) : ""));
  return normalizeQuadrantNote([block.first, ...rest].join("\n"));
}

/** Reads the text of the `## Quadrants` section (LF line endings, heading included). */
export function parseQuadrants(section: string): ParsedQuadrants {
  const notes = emptyQuadrantNotes();
  const raw: string[] = [];
  const seen = new Set<QuadrantKey>();
  let open = null as Block | null;

  const close = () => {
    if (open) notes[open.key] = finishBlock(open);
    open = null;
  };

  for (const line of section.split("\n")) {
    if (/^##\s+/.test(line)) continue; // the `## Quadrants` heading itself
    if (!line.trim()) {
      // A blank line is part of an open note (a paragraph break) and nothing else.
      if (open) open.rest.push("");
      continue;
    }
    const indented = /^[ \t]/.test(line);
    if (indented) {
      if (open) open.rest.push(line.replace(/\s+$/, ""));
      else raw.push(line.trimEnd());
      continue;
    }

    close();
    const m = ENTRY_RE.exec(line);
    if (m && isKey(m[1]) && !seen.has(m[1].slice(2) as QuadrantKey)) {
      const key = m[1].slice(2) as QuadrantKey;
      seen.add(key);
      open = { key, first: m[2] ?? "", rest: [] };
      continue;
    }
    raw.push(line.trimEnd());
  }
  close();
  return { notes, raw };
}

/** The `## Quadrants` section as written: empty when there is nothing, so a
 * matrix that does not use the feature costs nothing. */
export function formatQuadrantSection(notes: Partial<QuadrantNotes>, raw: string[]): string {
  const lines: string[] = [];
  for (const key of QUADRANT_KEYS) {
    const note = normalizeQuadrantNote(notes[key] ?? "");
    if (!note) continue;
    const [first, ...rest] = note.split("\n");
    lines.push(`- ${KEY_PREFIX}${key} ${first}`);
    for (const line of rest) lines.push(line ? `${INDENT}${line}` : "");
  }
  const body = [...lines, ...raw].join("\n");
  return body ? `## Quadrants\n\n${body}\n\n` : "";
}

/** Edits of one quadrant's note within this window are one undo step. */
export const NOTE_UNDO_WINDOW_MS = 1500;

export interface LastNoteEdit {
  key: QuadrantKey;
  at: number;
}

/** Whether an edit of `key` at `now` joins the previous one into a single undo entry. */
export function shouldCoalesce(key: QuadrantKey, last: LastNoteEdit | null, now: number): boolean {
  return last !== null && last.key === key && now - last.at <= NOTE_UNDO_WINDOW_MS;
}
