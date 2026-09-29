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
import { parseFrontmatter, parseNote } from "./note.mjs";

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
  // The decision policy's own limit, and the only one it has: a count of its
  // entries across every section, not lines and not a quota per section. A
  // per-section quota makes a rule's home depend on which box has room rather
  // than on what the rule is; a line count lets the entries grow while the
  // prose around them shrinks. The number is not a measured optimum — it is
  // the point at which the owner is asked to consolidate (T-0458).
  policyEntries: 40,
  policyEntryLines: 3,
};

/**
 * How long an axis may go uncited before `axes` reports it as a candidate for
 * moving down to notes/. Measured from `axes_since` in the policy's
 * frontmatter, so nothing is reported before a full window of citations exists.
 */
export const AXIS_UNUSED_DAYS = 90;

/**
 * When `notes` search should stop being a text scan. Not a cap — notes/ has
 * none — but the point where keyword matching starts missing paraphrases often
 * enough to matter, and a derived index under `memory/.index/` earns its
 * upkeep. The search entry point stays the same either way (T-0375).
 */
export const NOTES_INDEX_THRESHOLD = 500;

/**
 * The decision policy as entries: one top-level `- ` or `1. ` item each, from
 * every `## ` section, continuation lines included. `id` is the `P-NN` the
 * entry opens with, or null — it is how a recommendation or a decision note
 * cites the axis it stood on (T-0458).
 */
export function policyEntries(policyText) {
  const entries = [];
  let section = null;
  // A continuation line must follow its entry directly: a blank line ends it,
  // so an indented `<!-- e.g. -->` example further down is not counted as one.
  let open = false;
  for (const line of policyText.split(/\r?\n/)) {
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      open = false;
      continue;
    }
    if (section === null) continue;
    if (/^(?:-|\d+\.)\s/.test(line)) {
      const id = /^(?:-|\d+\.)\s+(P-\d+)\b/.exec(line)?.[1] ?? null;
      entries.push({ section, id, lines: [line] });
      open = true;
    } else if (open && /^\s+\S/.test(line)) {
      entries[entries.length - 1].lines.push(line);
    } else {
      open = false;
    }
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

  const entries = policyEntries(text);
  if (entries.length > CAPS.policyEntries) {
    findings.push({
      cap: "policy entries",
      detail: `${entries.length} entries (cap ${CAPS.policyEntries})`,
      fix: "a new entry arrives by merging two or dropping one — which survives is the owner's call",
    });
  }
  for (const entry of entries) {
    if (entry.lines.length > CAPS.policyEntryLines) {
      findings.push({
        cap: `policy entry ${entry.id ?? "(no id)"}`,
        detail: `${entry.lines.length} lines (cap ${CAPS.policyEntryLines}): ${entry.lines[0].slice(0, 40)}…`,
        fix: "state the axis, not the case — the case belongs in notes/",
      });
    }
  }
  const seen = new Set();
  const unlabelled = entries.filter((e) => e.id === null).length;
  const duplicated = entries.filter((e) => e.id && (seen.has(e.id) || !seen.add(e.id))).map((e) => e.id);
  if (unlabelled || duplicated.length) {
    findings.push({
      cap: "policy ids",
      detail: [
        unlabelled ? `${unlabelled} without a P-NN id` : "",
        duplicated.length ? `duplicated: ${duplicated.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      fix: "give each entry the next unused P-NN, never reuse or renumber one — it is how the axis is cited",
    });
  }

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

  // A count, not a read: parsing hundreds of notes just to measure the layer
  // is the very cost this finding warns about.
  const notesDir = layerDir(vault, "notes");
  const noteCount = existsSync(notesDir)
    ? readdirSync(notesDir).filter((name) => name.endsWith(".md") && name !== "README.md").length
    : 0;
  if (noteCount > NOTES_INDEX_THRESHOLD) {
    findings.push({
      cap: "notes search",
      detail: `${noteCount} notes (threshold ${NOTES_INDEX_THRESHOLD})`,
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
    // The policy is capped by its entry count, not by its length.
    if (note.slug === "decision-policy") continue;
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

const DAY_MS = 86400000;

/** When a note happened: its own date field, else the file's mtime. */
function dateOfNote(text, path) {
  const { frontmatter } = parseFrontmatter(text);
  for (const key of ["decided", "created", "updated"]) {
    const t = Date.parse(String(frontmatter[key] ?? ""));
    if (!Number.isNaN(t)) return t;
  }
  return statSync(path).mtimeMs;
}

/**
 * Which policy entries have been cited lately (T-0458).
 *
 * A cap is a number nobody measured; use is a measurement. An axis that no
 * recommendation, decision or question has stood on for a season is one the
 * owner can move down to notes/. `## Always ask` is left out on purpose: a
 * safety entry is rarely reached exactly because it works.
 *
 * Citations are `P-NN` in `memory/notes/` and `_ai/comms/`, dated by the note.
 * Nothing is reported until `axes_since` is a full window old, or an empty
 * record would read as "nothing is used".
 *
 * @returns {{status: "off"}
 *   | {status: "collecting", since: string, remaining: number}
 *   | {status: "ready", days: number, unused: object[], cited: Record<string, number>}}
 */
export function axisUsage(vault, { now = Date.now(), days = AXIS_UNUSED_DAYS } = {}) {
  const path = join(layerDir(vault, "identity"), "decision-policy.md");
  if (!existsSync(path)) return { status: "off" };
  const text = readFileSync(path, "utf8");
  const { frontmatter } = parseFrontmatter(text);
  const since = Date.parse(String(frontmatter.axes_since ?? ""));
  if (Number.isNaN(since)) return { status: "off" };

  const elapsed = Math.floor((now - since) / DAY_MS);
  if (elapsed < days) {
    return { status: "collecting", since: String(frontmatter.axes_since), remaining: days - elapsed };
  }

  const cited = {};
  for (const dir of [layerDir(vault, "notes"), join(vault, "_ai", "comms")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md") || name === "README.md") continue;
      const file = join(dir, name);
      const raw = readFileSync(file, "utf8");
      if (dateOfNote(raw, file) < now - days * DAY_MS) continue;
      for (const id of new Set(raw.match(/\bP-\d+\b/g) ?? [])) cited[id] = (cited[id] ?? 0) + 1;
    }
  }

  const unused = policyEntries(text)
    .filter((e) => e.id && e.section !== "Always ask" && !cited[e.id])
    .map((e) => ({
      id: e.id,
      section: e.section,
      head: e.lines[0].replace(/^(?:-|\d+\.)\s+P-\d+\s*/, "").slice(0, 60),
    }));
  return { status: "ready", days, unused, cited };
}
