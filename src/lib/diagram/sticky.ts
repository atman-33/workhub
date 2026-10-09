/**
 * Sticky notes (`## Stickies`), shared by every diagram kind.
 *
 * A sticky is a note pinned to an element of the diagram. Its position is
 * stored only relative to that element, so it follows the element wherever
 * the layout or the user moves it.
 *
 *   - S-001 node:<element-id> @<dx>,<dy> [#<color>] [text]
 *     <optional continuation lines, indented - more of the text>
 *
 * The key stays `node:` in the file whatever the kind (the Mindmap notes that
 * already exist must keep parsing); in the model it is `targetId`.
 */
import { COLORS, type Color } from "./colors";
import { formatId, isContinuation } from "./note";

export interface Sticky {
  /**
   * Stable, file-unique id (`S-001`). Never reassigned and never reused - the
   * same contract as an element id, and for the same reason.
   */
  id: string;
  /** Id of the element this sticky is pinned to. */
  targetId: string;
  /**
   * Offset from the element's centre to the sticky's top-left corner, in
   * diagram pixels. Anchored on the centre rather than on a corner because a
   * box grows and shrinks with its title, and its centre moves half as far.
   */
  dx: number;
  dy: number;
  /** Paper colour. Absent means `amber`, the default. */
  color?: Color;
  /** Body text. May span several lines - continuation lines in the file. */
  text: string;
}

/** Where a sticky lands when the file does not say, so that a hand-written
 * `- S-001 node:N-004 text` still appears somewhere sensible. */
export const STICKY_DEFAULT_OFFSET = { dx: 32, dy: 24 };

/** The colour a sticky is drawn in when it carries none of its own. */
export const STICKY_DEFAULT_COLOR: Color = "amber";

/**
 * Where a newly added sticky lands, as an offset from its element's centre,
 * and how far each further sticky on the same element is staggered.
 */
export const NEW_STICKY_OFFSET = { dx: 96, dy: 24 };
export const NEW_STICKY_STAGGER = { dx: 14, dy: 18 };

const STICKY_ID_RE = /^S-\d+$/;
/** `@24,-36` - the offset from the pinned element's centre. */
const OFFSET_RE = /^@(-?\d+),(-?\d+)$/;

/** `- S-001 node:N-004 @24,-36 #amber 見積りは仮` */
function parseStickyLine(line: string): { sticky: Sticky; hadId: boolean } | null {
  const m = /^\s*-\s+(.*)$/.exec(line);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;

  const tokens = body.split(/\s+/).filter(Boolean);
  let id = "";
  let hadId = false;
  if (STICKY_ID_RE.test(tokens[0])) {
    id = tokens[0];
    hadId = true;
    tokens.shift();
  }

  let targetId = "";
  let color: Color | undefined;
  let dx: number | undefined;
  let dy: number | undefined;
  const textTokens: string[] = [];
  // Modifiers may appear in any order, exactly as on an element line; whatever
  // is left over is the sticky's text, so an unrecognized `#word` or a stray
  // `@` in the prose stays part of it.
  for (const tok of tokens) {
    const offset = OFFSET_RE.exec(tok);
    if (tok.startsWith("node:") && tok.length > 5 && !targetId) {
      targetId = tok.slice(5);
    } else if (offset && dx === undefined) {
      dx = Number(offset[1]);
      dy = Number(offset[2]);
    } else if (tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1))) {
      color = tok.slice(1) as Color;
    } else {
      textTokens.push(tok);
    }
  }
  // Without a target there is nothing to pin to, so the line is not a sticky -
  // the caller keeps it verbatim rather than inventing an anchor for it.
  if (!targetId) return null;

  return {
    hadId,
    sticky: {
      id,
      targetId,
      dx: dx ?? STICKY_DEFAULT_OFFSET.dx,
      dy: dy ?? STICKY_DEFAULT_OFFSET.dy,
      text: textTokens.join(" "),
      ...(color ? { color } : {}),
    },
  };
}

export interface ParsedStickies {
  stickies: Sticky[];
  /** Lines the grammar did not recognize, kept verbatim. */
  raw: string[];
  /** True when at least one id had to be minted. */
  minted: boolean;
}

/**
 * Parses a `## Stickies` section.
 *
 * Forgiving the way the element grammar is: a line it cannot read is handed
 * back to be written out untouched, so hand-editing the section in Obsidian
 * can never cost the user a sticky.
 */
export function parseStickies(section: string): ParsedStickies {
  const out: ParsedStickies = { stickies: [], raw: [], minted: false };
  const notes = new Map<Sticky, string[]>();
  let open: Sticky | null = null;

  for (const line of section.split("\n")) {
    if (/^##\s+/.test(line)) continue; // the `## Stickies` heading itself
    if (!line.trim()) continue;

    const parsed = parseStickyLine(line);
    if (parsed) {
      out.stickies.push(parsed.sticky);
      if (!parsed.hadId) out.minted = true;
      open = parsed.sticky;
      continue;
    }
    if (open && isContinuation(line)) {
      const collected = notes.get(open);
      if (collected) collected.push(line.trim());
      else notes.set(open, [line.trim()]);
      continue;
    }
    open = null;
    out.raw.push(line.trimEnd());
  }

  for (const [sticky, collected] of notes) {
    sticky.text = [sticky.text, ...collected].filter(Boolean).join("\n");
  }

  if (assignMissingStickyIds(out.stickies)) out.minted = true;
  return out;
}

/** Gives every id-less sticky an id, and repairs duplicates. Returns whether
 * anything was minted. */
function assignMissingStickyIds(stickies: Sticky[]): boolean {
  const seen = new Set<string>();
  let max = 0;
  for (const sticky of stickies) {
    const n = /^S-(\d+)$/.exec(sticky.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  let minted = false;
  for (const sticky of stickies) {
    if (!sticky.id || seen.has(sticky.id)) {
      max += 1;
      sticky.id = formatId("S", max);
      minted = true;
    }
    seen.add(sticky.id);
  }
  return minted;
}

/** Next free `S-NNN` for this document. Ids are never reused. */
export function nextStickyId(stickies: Sticky[]): string {
  let max = 0;
  for (const sticky of stickies) {
    const n = /^S-(\d+)$/.exec(sticky.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return formatId("S", max + 1);
}

/** The stickies pinned to one element, in file order. */
export function stickiesOf(stickies: Sticky[], targetId: string): Sticky[] {
  return stickies.filter((s) => s.targetId === targetId);
}

/** Renders one sticky: its grammar line plus any further lines of its text. */
export function formatSticky(sticky: Sticky): string[] {
  const parts = [
    sticky.id,
    `node:${sticky.targetId}`,
    `@${Math.round(sticky.dx)},${Math.round(sticky.dy)}`,
  ];
  if (sticky.color) parts.push(`#${sticky.color}`);

  const lines = sticky.text.replace(/\s+$/, "").split("\n");
  const first = lines[0]?.trim() ?? "";
  if (first) parts.push(first);

  const out = [`- ${parts.join(" ")}`];
  for (const line of lines.slice(1)) out.push(`  ${line}`);
  return out;
}

/** The `## Stickies` section as it is written: empty when there is nothing, so
 * the feature costs nothing to a diagram that does not use it. */
export function formatStickySection(stickies: Sticky[], raw: string[]): string {
  const body = [...stickies.flatMap(formatSticky), ...raw].join("\n");
  return body ? `## Stickies\n\n${body}\n\n` : "";
}

/** A sticky that no element accounts for. It stays in the file; nothing draws it. */
export function strayStickies(stickies: Sticky[], targetIds: Set<string>): Sticky[] {
  return stickies.filter((s) => !targetIds.has(s.targetId));
}
