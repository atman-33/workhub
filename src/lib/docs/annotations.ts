/**
 * Notes the reader leaves on a document in the Docs tab, and the prompt they
 * are handed to an AI agent as (T-0299).
 *
 * This is what the tab has instead of an editor. `src-tauri/src/docs.rs` must
 * never write into a document root, so the tab cannot offer to save a change;
 * what it can do is let the reader mark what should change and turn that into
 * a request. The writing is then done by an agent — a separate process, whose
 * access to the folder is the owner's operational call, not the app's.
 *
 * Nothing here reaches the backend. Notes live in `localStorage`, next to the
 * Recent files list (`./recent`) and for the same reason the repo rule
 * `.claude/rules/settings-placement.md` gives: this is per-machine working
 * state, not a decision that travels with the vault. They are also disposable
 * — once a note is in a prompt its job is done — so a store that survives a
 * reinstall would be storing rubbish.
 */

/** One note on one document. */
export interface DocNote {
  id: string;
  /**
   * 1-based line in the file, when the renderer could place the selection.
   * Markdown and plain text can; an HTML page is parsed and has no line to
   * report, so the quote is the only anchor there.
   */
  line?: number;
  /** The selected text, trimmed to `QUOTE_MAX`. */
  quote: string;
  /**
   * Which occurrence of `quote` in the rendered document this is, 0-based.
   * Without it a note on the second "See below" highlights the first.
   */
  occurrence: number;
  /** What the reader wants done. This is the instruction the agent reads. */
  comment: string;
  /** ISO timestamp, for the list's ordering and the prompt's context. */
  createdAt: string;
  /** `contentStamp` of the document when the note was taken. */
  stamp: string;
}

/**
 * How much of the selection is kept.
 *
 * Enough to find the passage again and to read in a list, not so much that a
 * note on three paragraphs stores all three. The agent has the file.
 */
export const QUOTE_MAX = 200;

const KEY_PREFIX = "docs.notes.";

/**
 * The store key for one document: the root's id and the path within it.
 *
 * Never the absolute path — that is machine-local, so a share mounted on a
 * different drive letter on another machine would read as a different
 * document.
 */
function keyFor(rootId: string, relPath: string): string {
  return `${KEY_PREFIX}${rootId}|${relPath}`;
}

function isNote(value: unknown): value is DocNote {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.quote === "string" &&
    typeof n.comment === "string" &&
    typeof n.occurrence === "number" &&
    (n.line === undefined || typeof n.line === "number")
  );
}

/** The notes on one document, oldest first. */
export function readNotes(rootId: string, relPath: string): DocNote[] {
  if (!rootId || !relPath) return [];
  try {
    const raw = localStorage.getItem(keyFor(rootId, relPath));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isNote) : [];
  } catch {
    // Unreadable or not JSON — no notes is the harmless answer.
    return [];
  }
}

/** Replaces the notes on one document; an empty list drops the key. */
export function writeNotes(rootId: string, relPath: string, notes: DocNote[]): DocNote[] {
  if (!rootId || !relPath) return notes;
  try {
    const key = keyFor(rootId, relPath);
    if (notes.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(notes));
  } catch {
    // Storage unavailable — the notes live in this session's state only.
  }
  return notes;
}

/**
 * A short id, unique enough for a list one person is typing into.
 *
 * `crypto.randomUUID` is deliberately not used: it is undefined on a
 * non-secure origin, and this module is also loaded by the viewer window.
 */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addNote(
  rootId: string,
  relPath: string,
  notes: DocNote[],
  note: Omit<DocNote, "id" | "createdAt">,
): DocNote[] {
  const next = [
    ...notes,
    {
      ...note,
      quote: note.quote.slice(0, QUOTE_MAX),
      id: newId(),
      createdAt: new Date().toISOString(),
    },
  ];
  return writeNotes(rootId, relPath, next);
}

export function updateNote(
  rootId: string,
  relPath: string,
  notes: DocNote[],
  id: string,
  comment: string,
): DocNote[] {
  const next = notes.map((n) => (n.id === id ? { ...n, comment } : n));
  return writeNotes(rootId, relPath, next);
}

export function removeNote(
  rootId: string,
  relPath: string,
  notes: DocNote[],
  id: string,
): DocNote[] {
  return writeNotes(
    rootId,
    relPath,
    notes.filter((n) => n.id !== id),
  );
}

export function clearNotes(rootId: string, relPath: string): DocNote[] {
  return writeNotes(rootId, relPath, []);
}

/**
 * A cheap fingerprint of the document, stored with each note.
 *
 * It answers one question: has this file changed since the note was taken? A
 * colleague edits the same share, so the answer is routinely yes, and a note
 * whose passage has moved or gone is worth flagging rather than silently
 * pointing at the wrong place.
 *
 * The file's own mtime would do as well, but the preview never reads one — it
 * is handed the text — and asking the backend for metadata would mean a new
 * command on a module whose point is that it has as few as possible. The text
 * is already here; hashing it is free and detects a real edit rather than a
 * touch.
 */
export function contentStamp(text: string): string {
  // FNV-1a, 32-bit. Not a checksum anyone depends on — a changed document
  // that happens to collide only costs a warning that is not shown.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}.${(hash >>> 0).toString(36)}`;
}

/** True when any note was taken against a different version of the text. */
export function notesAreStale(notes: DocNote[], stamp: string): boolean {
  return notes.some((n) => n.stamp !== stamp);
}

/** One note's line in the prompt. */
function promptLine(note: DocNote): string {
  const where = note.line ? `L${note.line} ` : "";
  // Collapsed, so a note taken across a line break stays one line of the
  // prompt rather than breaking the list.
  const quote = note.quote.replace(/\s+/g, " ").trim();
  const comment = note.comment.trim();
  return `- ${where}"${quote}"${comment ? ` — ${comment}` : ""}`;
}

export interface PromptContext {
  /** The root's display name, as the tab labels it. */
  rootName: string;
  /** The document's path within the root. */
  relPath: string;
  /** Its absolute path on this machine — what the agent actually opens. */
  absPath: string;
  notes: DocNote[];
  /** True when the document has changed since the notes were taken. */
  stale: boolean;
}

/**
 * The request the notes become.
 *
 * Two instructions are always present, because the two failure modes they
 * guard against are not obvious from the notes themselves:
 *
 * - **re-read the file.** The line numbers and quotes are from when the notes
 *   were taken, and the document may well have moved on.
 * - **show the change before writing it.** A document root is not a
 *   repository: no diff, no CI, no review, and usually no git at all — so an
 *   overwrite of somebody's prose has no undo. That is as true of a local
 *   folder as of a shared one, which is why this is unconditional.
 *
 * It deliberately does *not* say "unless the folder is shared". Nothing can
 * tell a synced folder from a local one by its path — a mapped drive is just a
 * drive letter — so a condition worded that way asks the agent to decide
 * something it cannot know, and it would decide differently every time. The
 * instruction also stops at approval rather than at a proposal: the write
 * still happens in the same session, it just happens after the reader has
 * seen it.
 */
export function buildPrompt(ctx: PromptContext): string {
  const lines = [
    "Apply the notes below to this document.",
    "",
    "- Read the file as it is now before changing anything. The line numbers and",
    "  quotes below are from when the notes were taken.",
    "- Show the change as a diff and get it approved before writing it. Never",
    "  overwrite the file silently.",
    "",
    `Document: ${ctx.rootName}/${ctx.relPath}`,
    `Path: ${ctx.absPath}`,
  ];
  if (ctx.stale) {
    lines.push(
      "Warning: the file has changed since these notes were taken, so a passage",
      "may have moved or be gone.",
    );
  }
  lines.push("", "## Notes", "");
  for (const note of ctx.notes) lines.push(promptLine(note));
  return `${lines.join("\n")}\n`;
}
