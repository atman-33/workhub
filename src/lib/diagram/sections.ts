/**
 * Notes with several managed sections (the business flow: `## Lanes`,
 * `## Steps`, `## Edges`, then `## Stickies`).
 *
 * `splitSections` in `note.ts` handles one primary section and the stickies;
 * this is the general form. The note is cut into its frontmatter and a list of
 * segments - the text before the first heading, then one segment per `## `
 * heading. The managed ones are read and regenerated; every other segment
 * (`## Memo`, a human's own section) is carried through byte for byte, in its
 * place.
 */
import { splitFrontmatter } from "./note";

export interface Segment {
  /** Heading text without the `## `, or `null` for the text before the first heading. */
  name: string | null;
  /** The segment as written, heading line included, ending where the next heading begins. */
  text: string;
}

export interface SplitNote {
  frontmatter: string;
  segments: Segment[];
}

const HEADING_RE = /^##\s+(.*?)\s*$/;

/** Cuts a note (LF line endings) into frontmatter and heading segments. */
export function splitNote(content: string): SplitNote {
  const { frontmatter, rest } = splitFrontmatter(content);
  const segments: Segment[] = [];
  let name: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (name !== null || buffer.length) segments.push({ name, text: buffer.join("") });
    buffer = [];
  };
  // Keep each line's own terminator so the join reproduces the text exactly.
  for (const line of rest.split(/(?<=\n)/)) {
    const m = HEADING_RE.exec(line.replace(/\n$/, ""));
    if (m) {
      flush();
      name = m[1];
    }
    buffer.push(line);
  }
  flush();
  return { frontmatter, segments };
}

/** The first segment named `name`, or `undefined`. A repeated heading after it
 * is not managed: it stays where it is, as text. */
export function sectionText(note: SplitNote, name: string): string {
  return note.segments.find((s) => s.name === name)?.text ?? "";
}

/**
 * Puts regenerated text into the managed sections and returns the whole body.
 *
 * `managed` lists the section names in their canonical order with the text to
 * write for each ("" removes an optional one). A section already in the note is
 * replaced where it stands. One that is missing is inserted after the nearest
 * managed section before it in canonical order, else before the nearest one
 * after it, else before `## Memo`, else at the end.
 */
export function replaceSections(
  note: SplitNote,
  managed: { name: string; text: string }[],
): string {
  const done = new Set<string>();
  const segments: Segment[] = [];
  for (const seg of note.segments) {
    const m = seg.name !== null ? managed.find((x) => x.name === seg.name) : undefined;
    if (m && !done.has(m.name)) {
      done.add(m.name);
      segments.push({ name: m.name, text: m.text });
    } else {
      segments.push(seg);
    }
  }

  managed.forEach((m, index) => {
    if (done.has(m.name) || !m.text) return;
    let at = -1;
    for (let i = index - 1; i >= 0 && at === -1; i--) {
      at = segments.findIndex((s) => s.name === managed[i].name);
      if (at !== -1) at += 1;
    }
    for (let i = index + 1; i < managed.length && at === -1; i++) {
      at = segments.findIndex((s) => s.name === managed[i].name);
    }
    if (at === -1) at = segments.findIndex((s) => s.name === "Memo");
    if (at === -1) at = segments.length;
    segments.splice(at, 0, { name: m.name, text: m.text });
    done.add(m.name);
  });

  // A section that ends the file without a blank line would run into the one
  // inserted after it; make sure each segment hands over with a line break.
  let out = "";
  for (const seg of segments) {
    if (out && !out.endsWith("\n")) out += "\n";
    out += seg.text;
  }
  return `${note.frontmatter}${out}`;
}
