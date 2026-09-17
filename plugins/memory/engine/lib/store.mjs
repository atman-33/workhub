// The `memory/` folder: the record itself.
//
// Everything durable lives here as Markdown, in git, readable and fixable by
// hand. The SQLite database beside it holds verbatim conversation and an index
// — both derived, both disposable. That split is not tidiness: the index can be
// rebuilt and the verbatim layer decays, while a promoted fact is the thing
// that actually makes the next session better and must survive a machine.
//
//   memory/
//     README.md      the startup router — read every session
//     identity/      who the owner is and how they decide; read in full, capped
//     notes/         everything durable and searchable; one typed note per thing
//     episodes/      where a session stopped; decays
//     archive/       superseded notes, kept in the graph
//     .index/        derived, gitignored
//
// The layers split by how something reaches a session, not by what it is
// about. "Is this a fact or a procedure" has no answer you can rely on at 2am;
// "is this read every time, or only when searched" always does — and it is the
// second question that decides whether a layer needs a cap.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { parseNote } from "./note.mjs";

export const LAYERS = ["identity", "notes", "episodes"];

export function memoryRoot(vault) {
  return join(vault, "memory");
}

export function layerDir(vault, layer) {
  return join(memoryRoot(vault), layer);
}

export function archiveDir(vault) {
  return join(memoryRoot(vault), "archive");
}

/** Has this vault been given a memory folder yet? */
export function hasStore(vault) {
  return Boolean(vault) && existsSync(memoryRoot(vault));
}

/**
 * Every note in a layer, parsed, newest first.
 *
 * Reading the whole layer is affordable because the layers are small by
 * design — `identity/` is capped, and `episodes/` is pruned. A layer that
 * grows past this is a layer that has stopped being promoted from, which the
 * caps are there to catch.
 */
export function readLayer(vault, layer) {
  const dir = layerDir(vault, layer);
  if (!existsSync(dir)) return [];
  const notes = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const path = join(dir, name);
    try {
      const note = parseNote(readFileSync(path, "utf8"));
      notes.push({ ...note, path, slug: basename(name, ".md"), mtime: statSync(path).mtimeMs });
    } catch {
      // An unreadable note is reported by `doctor`, not thrown from a read.
    }
  }
  return notes.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Notes matching a structured query — the briefing's only way of asking.
 *
 * Structured, not fuzzy, on purpose: a briefing wants *the* open decisions and
 * *the* live threads, not the notes that came out nearest in a vector space.
 * Similarity search is for an open question, and lives in the retriever.
 *
 * @param {object} where e.g. `{ type: "decision", status: "open" }`
 */
export function query(vault, layers, where = {}) {
  const wanted = Object.entries(where);
  const found = [];
  for (const layer of layers) {
    for (const note of readLayer(vault, layer)) {
      const ok = wanted.every(([key, value]) => {
        const actual = note.frontmatter?.[key];
        if (Array.isArray(value)) return value.includes(String(actual ?? ""));
        return String(actual ?? "") === String(value);
      });
      if (ok) found.push({ ...note, layer });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

function slugify(title) {
  const slug = String(title)
    .trim()
    .toLowerCase()
    // Keep Japanese: this vault's notes are routinely titled in it, and
    // stripping to ASCII would leave every one of them called "note".
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "note";
}

/** Where a note with this title and thread key lives. */
export function notePath(vault, layer, title, threadKey = "") {
  const name = threadKey ? `${threadKey}-${slugify(title)}` : slugify(title);
  return join(layerDir(vault, layer), `${name}.md`);
}

/**
 * Find the note a thread already wrote, if it wrote one.
 *
 * A thread gets one note, rewritten — not a pile of appends. The key comes
 * from the session id the harness already exports, which is also what the
 * task marker is filed under, so the two agree without being told.
 */
export function findByThread(vault, layer, threadKey) {
  if (!threadKey) return null;
  return readLayer(vault, layer).find((n) => n.frontmatter?.thread === threadKey) ?? null;
}

/** Write a note, creating the layer if it is not there yet. Returns the path. */
export function writeNote(vault, layer, path, contents) {
  mkdirSync(layerDir(vault, layer), { recursive: true });
  writeFileSync(path, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  return path;
}

/**
 * Move a note out of the active layers.
 *
 * Archive, never delete: a deleted note takes its observations and its links
 * out of the graph with it, and the links break silently on the other side.
 * A move is reversible, which is why it needs no permission.
 */
export function archiveNote(vault, path) {
  const dir = archiveDir(vault);
  mkdirSync(dir, { recursive: true });
  let target = join(dir, basename(path));
  if (existsSync(target)) {
    target = join(dir, `${basename(path, ".md")}-${Date.now()}.md`);
  }
  renameSync(path, target);
  return target;
}

/**
 * Caps, measured. Identity is read in full on every session, so its size is
 * not a matter of taste — a note nobody can read in one pass stops being read.
 *
 * Reported, never enforced: which rule survives a merge is the owner's call,
 * and dropping one automatically is exactly the kind of silent edit this
 * design exists to avoid.
 */
export const CAPS = {
  identityNoteLines: 120,
  identityNotes: 8,
  episodes: 60,
};

export function capFindings(vault) {
  const findings = [];
  if (!hasStore(vault)) return findings;

  const identity = readLayer(vault, "identity");
  if (identity.length > CAPS.identityNotes) {
    findings.push({
      cap: "identity notes",
      detail: `${identity.length} notes (cap ${CAPS.identityNotes})`,
      fix: "merge two, or move one down to notes/ — identity is read in full every session",
    });
  }
  for (const note of identity) {
    const lines = note.body.split(/\r?\n/).length;
    if (lines > CAPS.identityNoteLines) {
      findings.push({
        cap: `identity/${note.slug}`,
        detail: `${lines} lines (cap ${CAPS.identityNoteLines})`,
        fix: "split the cases out into notes/ and keep only the axes here",
      });
    }
  }

  const episodes = readLayer(vault, "episodes");
  if (episodes.length > CAPS.episodes) {
    findings.push({
      cap: "episodes",
      detail: `${episodes.length} notes (cap ${CAPS.episodes})`,
      fix: "run the memory-reflect skill — promote what still matters, archive the rest",
    });
  }
  return findings;
}
