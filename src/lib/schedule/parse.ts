/**
 * Schedule note <-> document model.
 *
 * The note is Markdown a human also edits in Obsidian, so parsing is
 * deliberately forgiving and serialization is deliberately conservative:
 *
 * - Anything the grammar does not recognize is **kept, not dropped**. An
 *   unparsable line in `## Items` survives as a `raw` entry and is written
 *   back verbatim, so a typo costs the user the line's rendering — never the
 *   line itself.
 * - Only `## Non-working` and `## Items` are rewritten. The frontmatter block
 *   (apart from `updated`), `## Memo`, and every other section are copied
 *   byte-for-byte, which is what lets the app, Obsidian and the AI edit the
 *   same file without stepping on each other (design note §5.4).
 *
 * The grammar (design note §5.3):
 *
 *   - [<kind>] <id> <date-spec> <title> [#<color>] [task:<task-id>]
 *   - weekly: sat, sun
 *   - <YYYY-MM-DD>[..<YYYY-MM-DD>] <label>
 */

/** Element kinds. Kept to three on purpose — see the design note §3.2. */
export type ItemKind = "bar" | "milestone" | "note";

/**
 * Colors are a fixed list rather than free-form values (§14.1): the screen and
 * the HTML export must render a note identically, and only a closed set can
 * guarantee that without shipping a color parser to both.
 */
export const COLORS = ["blue", "green", "amber", "red", "purple", "gray"] as const;
export type Color = (typeof COLORS)[number];

export const COLOR_HEX: Record<Color, string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  purple: "#a855f7",
  gray: "#6b7280",
};

export interface ScheduleItem {
  kind: ItemKind;
  /** Stable, file-unique id (`I-001`). Never reassigned — it is how the AI and
   * the UI agree on which element is which. */
  id: string;
  /** `YYYY-MM-DD`. */
  start: string;
  /** `YYYY-MM-DD`; equals `start` for milestones and notes. */
  end: string;
  title: string;
  color?: Color;
  /** Linked task id (`T-0042`), if any. */
  task?: string;
}

/** Weekday indexes follow `Date#getDay()`: 0 = Sunday. */
export const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export interface NonWorkingRange {
  start: string;
  end: string;
  label: string;
}

export interface NonWorking {
  /** Weekday indexes (0-6) that are non-working every week. */
  weekly: number[];
  /** Explicit date ranges (a single day has `start === end`). */
  ranges: NonWorkingRange[];
}

export interface ScheduleDocModel {
  title: string;
  /** Display range as written in the frontmatter (`YYYY-MM-DD..YYYY-MM-DD`). */
  range: string;
  nonWorking: NonWorking;
  items: ScheduleItem[];
  /** Item lines the grammar did not recognize, preserved verbatim. */
  rawItems: string[];
  /** Non-working lines the grammar did not recognize, preserved verbatim. */
  rawNonWorking: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: string): boolean {
  return DATE.test(s);
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

interface Sections {
  frontmatter: string;
  /** Text between the frontmatter and `## Non-working`. */
  preamble: string;
  nonWorking: string;
  items: string;
  /** `## Memo` and everything after it — never touched. */
  tail: string;
}

/**
 * Splits the file into the four regions serialization needs. A note missing a
 * managed section still parses (the section comes back empty and is written
 * back in place), so a hand-started file is usable rather than rejected.
 */
function splitSections(content: string): Sections {
  let frontmatter = "";
  let rest = content;
  if (content.startsWith("---\n") || content.startsWith("---\r\n")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      const after = content.indexOf("\n", end + 1);
      const cut = after === -1 ? content.length : after + 1;
      frontmatter = content.slice(0, cut);
      rest = content.slice(cut);
    }
  }

  const nonWorkingAt = findHeading(rest, "Non-working");
  const itemsAt = findHeading(rest, "Items");
  // The first heading after `## Items` ends the managed region. Everything
  // from there on (`## Memo` and any other human section) is opaque tail.
  const tailAt = itemsAt === -1 ? -1 : nextHeading(rest, itemsAt);

  const firstManaged = nonWorkingAt === -1 ? itemsAt : nonWorkingAt;
  const preamble = firstManaged === -1 ? rest : rest.slice(0, firstManaged);
  const nonWorking =
    nonWorkingAt === -1
      ? ""
      : rest.slice(nonWorkingAt, itemsAt === -1 ? (tailAt === -1 ? rest.length : tailAt) : itemsAt);
  const items =
    itemsAt === -1 ? "" : rest.slice(itemsAt, tailAt === -1 ? rest.length : tailAt);
  const tail = firstManaged === -1 ? "" : tailAt === -1 ? "" : rest.slice(tailAt);

  return { frontmatter, preamble, nonWorking, items, tail };
}

function findHeading(text: string, name: string): number {
  const re = new RegExp(`^##\\s+${name}\\s*$`, "m");
  return text.search(re);
}

/** Offset of the next `## ` heading strictly after `from`, or -1. */
function nextHeading(text: string, from: number): number {
  const re = /^##\s+/m;
  const rest = text.slice(from + 1);
  const at = rest.search(re);
  return at === -1 ? -1 : from + 1 + at;
}

function frontmatterValue(frontmatter: string, key: string): string {
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() !== key) continue;
    return unquote(line.slice(idx + 1).trim());
  }
  return "";
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

/** `- [bar] I-001 2026-07-21..2026-08-07 build it #blue task:T-0090` */
function parseItemLine(line: string): ScheduleItem | null {
  const m = /^\s*-\s*\[(bar|milestone|note)\]\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
  if (!m) return null;
  const [, kind, id, dateSpec, restRaw] = m;

  let start: string;
  let end: string;
  if (dateSpec.includes("..")) {
    const [a, b] = dateSpec.split("..");
    if (!isDate(a) || !isDate(b)) return null;
    start = a;
    end = b;
  } else {
    if (!isDate(dateSpec)) return null;
    start = dateSpec;
    end = dateSpec;
  }
  // A reversed range is a data error the UI cannot render; keep the line as
  // raw so the user (or the AI) can see and fix it.
  if (end < start) return null;

  let rest = restRaw.trim();
  let color: Color | undefined;
  let task: string | undefined;
  // Trailing modifiers, in any order; anything left is the title.
  const tokens = rest.split(/\s+/).filter(Boolean);
  const titleTokens: string[] = [];
  for (const tok of tokens) {
    if (tok.startsWith("#") && (COLORS as readonly string[]).includes(tok.slice(1))) {
      color = tok.slice(1) as Color;
    } else if (tok.startsWith("task:") && tok.length > 5) {
      task = tok.slice(5);
    } else {
      titleTokens.push(tok);
    }
  }
  rest = titleTokens.join(" ");

  return {
    kind: kind as ItemKind,
    id,
    start,
    // A milestone/note carries a single date even if the file spelled a range.
    end: kind === "bar" ? end : start,
    title: rest,
    ...(color ? { color } : {}),
    ...(task ? { task } : {}),
  };
}

function parseNonWorkingLine(
  line: string,
): { weekly: number[] } | { range: NonWorkingRange } | null {
  const body = /^\s*-\s*(.*)$/.exec(line)?.[1]?.trim();
  if (!body) return null;

  const weeklyMatch = /^weekly:\s*(.*)$/i.exec(body);
  if (weeklyMatch) {
    const names = weeklyMatch[1]
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const weekly: number[] = [];
    for (const name of names) {
      const idx = (WEEKDAY_NAMES as readonly string[]).indexOf(name);
      if (idx === -1) return null; // unknown weekday: keep the line raw
      weekly.push(idx);
    }
    return { weekly };
  }

  const m = /^(\S+)\s*(.*)$/.exec(body);
  if (!m) return null;
  const [, spec, label] = m;
  if (spec.includes("..")) {
    const [a, b] = spec.split("..");
    if (!isDate(a) || !isDate(b) || b < a) return null;
    return { range: { start: a, end: b, label: label.trim() } };
  }
  if (!isDate(spec)) return null;
  return { range: { start: spec, end: spec, label: label.trim() } };
}

export function parseSchedule(content: string): ScheduleDocModel {
  const s = splitSections(content);
  const doc: ScheduleDocModel = {
    title: frontmatterValue(s.frontmatter, "title"),
    range: frontmatterValue(s.frontmatter, "range"),
    nonWorking: { weekly: [], ranges: [] },
    items: [],
    rawItems: [],
    rawNonWorking: [],
  };

  for (const line of s.nonWorking.split("\n")) {
    if (!line.trim() || line.trim().startsWith("##")) continue;
    const parsed = parseNonWorkingLine(line);
    if (!parsed) {
      doc.rawNonWorking.push(line.trimEnd());
    } else if ("weekly" in parsed) {
      // Last `weekly:` line wins; earlier ones are folded in rather than
      // dropped, so two lines behave like one combined list.
      for (const d of parsed.weekly) {
        if (!doc.nonWorking.weekly.includes(d)) doc.nonWorking.weekly.push(d);
      }
    } else {
      doc.nonWorking.ranges.push(parsed.range);
    }
  }
  doc.nonWorking.weekly.sort((a, b) => a - b);

  for (const line of s.items.split("\n")) {
    if (!line.trim() || line.trim().startsWith("##")) continue;
    const item = parseItemLine(line);
    if (item) doc.items.push(item);
    else doc.rawItems.push(line.trimEnd());
  }

  return doc;
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

export function formatItem(item: ScheduleItem): string {
  const dates = item.kind === "bar" ? `${item.start}..${item.end}` : item.start;
  const parts = [`- [${item.kind}]`, item.id, dates];
  if (item.title) parts.push(item.title);
  if (item.color) parts.push(`#${item.color}`);
  if (item.task) parts.push(`task:${item.task}`);
  return parts.join(" ");
}

function formatNonWorking(nw: NonWorking, raw: string[]): string[] {
  const lines: string[] = [];
  if (nw.weekly.length) {
    lines.push(`- weekly: ${nw.weekly.map((d) => WEEKDAY_NAMES[d]).join(", ")}`);
  }
  for (const r of nw.ranges) {
    const spec = r.start === r.end ? r.start : `${r.start}..${r.end}`;
    lines.push(`- ${spec}${r.label ? ` ${r.label}` : ""}`);
  }
  return [...lines, ...raw];
}

/**
 * Renders the model back into `content`, replacing only the managed sections
 * and stamping `updated`. Unrecognized lines are appended after the
 * recognized ones so nothing is lost, and every other byte of the file — the
 * rest of the frontmatter, `## Memo`, stray sections — is carried through.
 */
export function serializeSchedule(
  content: string,
  doc: ScheduleDocModel,
  today: string,
): string {
  const s = splitSections(content);
  const frontmatter = setFrontmatterValue(s.frontmatter, "updated", today);

  const nonWorkingBody = formatNonWorking(doc.nonWorking, doc.rawNonWorking).join("\n");
  const itemsBody = [...doc.items.map(formatItem), ...doc.rawItems].join("\n");

  const nonWorking = `## Non-working\n\n${nonWorkingBody}${nonWorkingBody ? "\n" : ""}\n`;
  const items = `## Items\n\n${itemsBody}${itemsBody ? "\n" : ""}\n`;

  return `${frontmatter}${s.preamble}${nonWorking}${items}${s.tail}`;
}

/** Rewrites one frontmatter key in place, appending it when absent. */
function setFrontmatterValue(frontmatter: string, key: string, value: string): string {
  if (!frontmatter) return frontmatter;
  const lines = frontmatter.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(":");
    if (idx === -1) continue;
    if (lines[i].slice(0, idx).trim() !== key) continue;
    lines[i] = `${key}: ${value}`;
    return lines.join("\n");
  }
  // No such key: insert before the closing `---`.
  const closing = lines.lastIndexOf("---");
  if (closing > 0) lines.splice(closing, 0, `${key}: ${value}`);
  return lines.join("\n");
}

/** Next free `I-NNN` for this document. Ids are never reused. */
export function nextItemId(items: ScheduleItem[]): string {
  let max = 0;
  for (const item of items) {
    const n = /^I-(\d+)$/.exec(item.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `I-${String(max + 1).padStart(3, "0")}`;
}
