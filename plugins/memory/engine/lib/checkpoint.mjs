// The checkpoint: where a thread got to, written before the context is lost.
//
// Compaction is a predictable amnesia. Everything the session worked out and
// did not write down goes with it, and the session afterwards starts guessing
// at ground it already covered. So the checkpoint is written *before*
// compaction, and again at the end of a session, into one note per thread.
//
// One note, rewritten — not a pile of appends. What a later reader needs is
// the current understanding, not a transcript of how it was reached: a decision
// that was overturned should read as the decision that replaced it, in the
// place the old one stood. An append-only checkpoint makes the reader
// reconstruct the present from the history, which is the work the note existed
// to save them.
import { existsSync, readFileSync } from "node:fs";
import { parseNote } from "./note.mjs";
import { findByThread, notePath, writeNote } from "./store.mjs";

/** Observations the caller could not supply are dropped, not invented. */
function observationLines(fields) {
  const lines = [];
  for (const [category, values] of Object.entries(fields)) {
    for (const value of [].concat(values ?? [])) {
      const text = String(value).replace(/\s+/g, " ").trim();
      if (text) lines.push(`- [${category}] ${text}`);
    }
  }
  return lines;
}

/**
 * Render a `session` note.
 *
 * `previous` is the note this thread wrote last time, when there is one. Its
 * body is carried forward as the starting point so a rewrite refines rather
 * than discards — but the caller's fields win, because they are newer.
 */
export function renderCheckpoint({
  title,
  thread,
  task = "",
  status = "open",
  started = "",
  summary = "",
  context = [],
  next_step = [],
  decision = [],
  problem = [],
  produced = [],
  body = "",
}) {
  const frontmatter = [
    "---",
    `title: ${title}`,
    "type: session",
    `status: ${status}`,
    ...(task ? [`task: ${task}`] : []),
    `thread: ${thread}`,
    ...(started ? [`started: ${started}`] : []),
    `updated: ${new Date().toISOString().slice(0, 10)}`,
    "---",
    "",
  ];

  const observations = observationLines({ summary, context, next_step, decision, problem });
  const relations = [].concat(produced ?? []).map((target) => `- produced [[${target}]]`);

  return [
    ...frontmatter,
    `# ${title}`,
    "",
    body.trim() ||
      "What this thread is about, and where it actually stands. Write it for a\n" +
        "reader who was not here — including a later session of your own.",
    "",
    "## Observations",
    ...(observations.length ? observations : ["- [summary] (not recorded)"]),
    ...(relations.length ? ["", "## Relations", ...relations] : []),
    "",
  ].join("\n");
}

/**
 * Write or rewrite this thread's checkpoint. Returns `{ path, rewritten }`.
 *
 * Writing a note is reversible — it creates a file in a git-tracked folder and
 * nothing else — so it needs no permission. Rewriting *this thread's own* note
 * is the same act continued: the alternative is a second note about the same
 * thread, which is worse than either.
 */
export function writeCheckpoint(vault, fields) {
  const previous = findByThread(vault, "episodes", fields.thread);
  const body =
    fields.body ||
    (previous ? bodyOf(previous) : "");
  const contents = renderCheckpoint({
    ...fields,
    started: fields.started || previous?.frontmatter?.started || new Date().toISOString(),
    body,
  });
  // Keep the path the thread already has, so a retitled checkpoint does not
  // leave its predecessor behind as a duplicate.
  const path =
    previous?.path ?? notePath(vault, "episodes", fields.title, shortThread(fields.thread));
  writeNote(vault, "episodes", path, contents);
  return { path, rewritten: Boolean(previous) };
}

/** The prose between the heading and the first structured section. */
function bodyOf(note) {
  const afterHeading = note.body.replace(/^\s*#[^\n]*\n/, "");
  const cut = afterHeading.search(/^##\s/m);
  return (cut === -1 ? afterHeading : afterHeading.slice(0, cut)).trim();
}

function shortThread(thread) {
  return String(thread).replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
}

/**
 * The last few exchanges of a transcript, as a starting point for a checkpoint.
 *
 * Extractive on purpose: this runs inside a hook, where an LLM call is not
 * available and a slow one would be worse than a rough note. A session that
 * wants a written summary runs the skill, which has a model to hand.
 */
export function extractTail(transcriptPath, { turns = 6 } = {}) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const prompts = [];
  for (const line of readFileSync(transcriptPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "user") continue;
      const content = entry.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((p) => p?.type === "text")
                .map((p) => p.text)
                .join("\n")
            : "";
      // Hook output and tool results arrive as user turns too; they are not
      // things the owner said.
      if (!text.trim() || text.startsWith("<")) continue;
      prompts.push(text.replace(/\s+/g, " ").trim().slice(0, 300));
    } catch {
      // A torn line at the end of a live transcript.
    }
  }
  return prompts.slice(-turns);
}
