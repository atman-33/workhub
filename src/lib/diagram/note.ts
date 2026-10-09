/**
 * Note input/output shared by every diagram kind: frontmatter keys, the
 * section split that keeps `## Memo` and unknown sections untouched, and id
 * minting.
 *
 * The note is Markdown a human also edits in Obsidian, so reading is forgiving
 * and writing is conservative: only the sections a kind manages are rewritten,
 * and every other byte of the file is carried through.
 */

/** One regular `key: value` frontmatter value, unquoted. */
export function frontmatterValue(frontmatter: string, key: string): string {
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

/** Drops one frontmatter key, leaving every other line as it was. */
export function removeFrontmatterKey(frontmatter: string, key: string): string {
  if (!frontmatter) return frontmatter;
  const lines = frontmatter.split("\n").filter((line) => {
    const idx = line.indexOf(":");
    return idx === -1 || line.slice(0, idx).trim() !== key;
  });
  return lines.join("\n");
}

/** Rewrites one frontmatter key in place, appending it when absent. */
export function setFrontmatterValue(frontmatter: string, key: string, value: string): string {
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

/**
 * Sets a key, or removes it when `value` is the default (empty). The "default
 * is the absence of the key" rule every display setting follows.
 */
export function setOrRemoveFrontmatterValue(
  frontmatter: string,
  key: string,
  value: string,
): string {
  return value ? setFrontmatterValue(frontmatter, key, value) : removeFrontmatterKey(frontmatter, key);
}

/**
 * Frontmatter values are one line and unquoted in these notes. A newline would
 * end the value early, and a leading `#` would read as a comment, so the value
 * is flattened to something that survives a round trip.
 */
export function frontmatterSafe(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

export interface Sections {
  frontmatter: string;
  /** Text between the frontmatter and the first managed section. */
  preamble: string;
  /** The kind's primary managed section (`## Nodes`, `## Items`), heading included. */
  managed: string;
  /** Text between the two managed sections, if a human put any there. */
  between: string;
  /** `## Stickies`, empty when the note has none. */
  stickies: string;
  /** `## Memo` and everything after it - never touched. */
  tail: string;
}

/** Cuts the leading `---` frontmatter block (closing line included) off a note. */
export function splitFrontmatter(content: string): { frontmatter: string; rest: string } {
  if (content.startsWith("---\n") || content.startsWith("---\r\n")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      const after = content.indexOf("\n", end + 1);
      const cut = after === -1 ? content.length : after + 1;
      return { frontmatter: content.slice(0, cut), rest: content.slice(cut) };
    }
  }
  return { frontmatter: "", rest: content };
}

/**
 * Splits the file into the regions serialization needs. A note missing its
 * primary section still parses (the section comes back empty and is written in
 * at the end), so a hand-started file is usable rather than rejected.
 *
 * There are two managed sections. `## Stickies` is optional and normally sits
 * straight after the primary one; a file that puts it somewhere else still
 * parses, and is written back with the two in the canonical order.
 */
export function splitSections(content: string, primary: string): Sections {
  const { frontmatter, rest } = splitFrontmatter(content);

  // Each managed section runs from its heading to the next heading of any
  // kind: everything else (`## Memo`, a human's own sections) is opaque and
  // copied through byte-for-byte.
  const region = (name: string): { at: number; end: number } | null => {
    const at = findHeading(rest, name);
    if (at === -1) return null;
    const next = nextHeading(rest, at);
    return { at, end: next === -1 ? rest.length : next };
  };
  const managed = region(primary);
  const stickies = region("Stickies");

  if (!managed) {
    // No primary section at all: nothing is managed, so the whole body is
    // preamble and serialization writes the section in at the end of it.
    return { frontmatter, preamble: rest, managed: "", between: "", stickies: "", tail: "" };
  }
  if (!stickies) {
    return {
      frontmatter,
      preamble: rest.slice(0, managed.at),
      managed: rest.slice(managed.at, managed.end),
      between: "",
      stickies: "",
      tail: rest.slice(managed.end),
    };
  }

  const first = Math.min(managed.at, stickies.at);
  const second = Math.max(managed.end, stickies.end);
  return {
    frontmatter,
    preamble: rest.slice(0, first),
    managed: rest.slice(managed.at, managed.end),
    between: rest.slice(Math.min(managed.end, stickies.end), Math.max(managed.at, stickies.at)),
    stickies: rest.slice(stickies.at, stickies.end),
    tail: rest.slice(second),
  };
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

/** An indented line that does not open a new list item continues the previous
 * one - ordinary Markdown list continuation, which is why an element written
 * this way still renders as a single item in Obsidian. */
export function isContinuation(line: string): boolean {
  return /^\s+/.test(line) && !/^\s*-\s/.test(line);
}

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

/** `M-007` for prefix `M`, number 7. Three digits minimum, more when needed. */
export function formatId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** The next free id for `prefix`: the highest number present, plus one. Ids
 * are never reused. */
export function nextId(prefix: string, ids: Iterable<string>): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const id of ids) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatId(prefix, max + 1);
}

/**
 * A frontmatter value as it is written: plain when that reads back the same,
 * quoted when it would not (a `: ` or ` #` inside, or a leading character YAML
 * gives a meaning). `frontmatterValue` strips one pair of quotes.
 */
export function frontmatterScalar(value: string): string {
  const v = frontmatterSafe(value);
  if (!v) return "";
  const risky = /^[#"'[\]{}&*!|>%@`,?-]/.test(v) || /: /.test(v) || / #/.test(v) || v.endsWith(":");
  if (!risky) return v;
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  return `"${v.replace(/"/g, "'")}"`;
}
