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
//     .index/        reserved for a derived index over notes/: gitignored,
//                    rebuildable from the Markdown, and not built yet —
//                    `searchNotes` scans until the store outgrows it (T-0375)
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

// Statuses a search leaves out unless asked for by name: a superseded note is
// kept for the record and the graph, but answering from it is answering with
// a call the owner has since reversed.
const HIDDEN_STATUSES = ["superseded"];

/**
 * The one way to search the store — structured and free-text in a single call.
 * Covers `notes/` and `episodes/`: a settled decision lives in the first, where
 * a session stopped (`type: session`) in the second, and "where did we get to"
 * is as much a recall question as "what did we decide".
 *
 * Frontmatter filters narrow first (`type`, `status`), then every term must
 * appear in the title or the body. Ranked by how many terms hit the title,
 * then by recency. A text scan, on purpose, for now: at a few hundred notes it
 * is fast and exact, and it needs nothing kept in sync. When the store outgrows
 * it (`NOTES_INDEX_THRESHOLD`, reported by `doctor`), the scan is replaced by a
 * derived index behind this same signature, and nothing that calls it changes.
 *
 * @param {object} [options]
 * @param {string} [options.text]    whitespace-separated terms, all required
 * @param {string} [options.type]    frontmatter `type`
 * @param {string} [options.status]  frontmatter `status`; naming a hidden one
 *                                   (`superseded`) is how you ask for it
 * @param {boolean} [options.all]    include hidden statuses
 * @param {boolean} [options.archive] search `archive/` as well
 */
export function searchNotes(vault, { text = "", type, status, all = false, archive = false } = {}) {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  const layers = archive ? ["notes", "episodes", "archive"] : ["notes", "episodes"];
  const found = [];
  for (const layer of layers) {
    for (const note of readLayer(vault, layer)) {
      const fm = note.frontmatter ?? {};
      if (type && String(fm.type ?? "") !== type) continue;
      if (status && String(fm.status ?? "") !== status) continue;
      if (!status && !all && HIDDEN_STATUSES.includes(String(fm.status ?? ""))) continue;

      const title = String(fm.title ?? note.slug).toLowerCase();
      const body = note.body.toLowerCase();
      if (!terms.every((term) => title.includes(term) || body.includes(term))) continue;
      const titleHits = terms.filter((term) => title.includes(term)).length;
      found.push({ ...note, layer, titleHits });
    }
  }
  return found.sort((a, b) => b.titleHits - a.titleHits || b.mtime - a.mtime);
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
  // The decision policy's own limit, and the one that actually bites: the
  // line count above is only the insurance derived from it (12 full-size rules
  // plus a filled `## Preferences` come to 118 lines). Counting lines would let
  // the rules grow while the prose around them shrank.
  promotedRules: 12,
  promotedRuleLines: 3,
};

/**
 * When `notes` search should stop being a text scan. Not a cap — notes/ has
 * none — but the point where keyword matching starts missing paraphrases often
 * enough to matter, and a derived index under `memory/.index/` earns its
 * upkeep. The search entry point stays the same either way (T-0375).
 */
export const NOTES_INDEX_THRESHOLD = 500;

/**
 * The `## Promoted rules` section of the decision policy, as entries: one
 * top-level `- ` bullet each, continuation lines included.
 */
export function promotedRules(policyText) {
  const lines = policyText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Promoted rules\s*$/.test(line));
  if (start === -1) return [];
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (line.startsWith("- ")) entries.push([line]);
    else if (entries.length && /^\s+\S/.test(line)) entries[entries.length - 1].push(line);
  }
  return entries;
}

// A case written into the policy instead of into notes/: a dated line that
// names a task, or one that carries the `(from: …)` of the old decision log.
const CASE_LINE = /^- \d{4}-\d{2}-\d{2} .*\bT-\d{4}\b|\(from:/;

function policyFindings(vault) {
  const path = join(layerDir(vault, "identity"), "decision-policy.md");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const findings = [];

  const rules = promotedRules(text);
  if (rules.length > CAPS.promotedRules) {
    findings.push({
      cap: "promoted rules",
      detail: `${rules.length} rules (cap ${CAPS.promotedRules})`,
      fix: "a new rule arrives by merging two or dropping one — which survives is the owner's call",
    });
  }
  rules.forEach((entry, i) => {
    if (entry.length > CAPS.promotedRuleLines) {
      findings.push({
        cap: `promoted rule ${i + 1}`,
        detail: `${entry.length} lines (cap ${CAPS.promotedRuleLines}): ${entry[0].slice(2, 40)}…`,
        fix: "state the axis, not the case — the case belongs in notes/",
      });
    }
  });

  const cases = text.split(/\r?\n/).filter((line) => CASE_LINE.test(line));
  if (cases.length) {
    findings.push({
      cap: "policy cases",
      detail: `${cases.length} line(s) read as individual cases: ${cases[0].slice(0, 40)}…`,
      fix: "move each case to a `type: decision` note in notes/ — the policy holds axes only",
    });
  }
  return findings;
}

export function capFindings(vault) {
  const findings = [];
  if (!hasStore(vault)) return findings;

  findings.push(...policyFindings(vault));

  const notes = readLayer(vault, "notes");
  if (notes.length > NOTES_INDEX_THRESHOLD) {
    findings.push({
      cap: "notes search",
      detail: `${notes.length} notes (threshold ${NOTES_INDEX_THRESHOLD})`,
      fix: "time to back `cli.mjs notes` with a derived index under memory/.index/ — callers stay as they are",
    });
  }

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
