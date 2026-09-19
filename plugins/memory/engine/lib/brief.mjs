// The session briefing: what a session is told before its first prompt.
//
// Structured, not fuzzy. It asks for the decisions that are still open and the
// threads that are still live — by `type` and `status`, deterministically — not
// for the notes that came out nearest in a vector space. "Things that look
// similar" is the wrong shape for an opening brief: it is right for an open
// question, which is what the retriever is for.
//
// It is also best-effort and never blocks a session. But it is not silent
// about itself: if capture has stopped recording, the brief says so. A memory
// that has quietly stopped working looks exactly like a memory with nothing to
// say, and telling those two apart is the whole point (T-0366).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { captureHealthLine } from "./capture.mjs";
import { daysSinceLast, reminder, timeSummary } from "./format.mjs";
import { reflectDueLine, setupTime } from "./reflect.mjs";
import { reflexes, WRITING_NOTE } from "./reflexes.mjs";
import { hasStore, query } from "./store.mjs";

/** How much of the graph one briefing may spend. */
const LIMITS = { decisions: 5, sessions: 3, chars: 9000 };

function titleOf(note) {
  return note.frontmatter?.title || note.slug;
}

/** The first `[category]` observation, which is the one-line form of a note. */
function firstObservation(note, categories) {
  for (const category of categories) {
    const hit = note.observations.find((o) => o.category === category);
    if (hit?.text) return hit.text;
  }
  return "";
}

function decisionBlock(vault) {
  const open = query(vault, ["notes"], { type: "decision", status: "open" }).slice(
    0,
    LIMITS.decisions,
  );
  if (!open.length) return "";
  const lines = ["## 未決の判断"];
  for (const note of open) {
    const what = firstObservation(note, ["decision"]);
    lines.push(`- [[${titleOf(note)}]]${what ? ` — ${what}` : ""}`);
  }
  return lines.join("\n");
}

function sessionBlock(vault) {
  const live = query(vault, ["episodes"], { type: "session", status: ["open", "resumed"] }).slice(
    0,
    LIMITS.sessions,
  );
  if (!live.length) return "";
  const lines = ["## 進行中のスレッド"];
  for (const note of live) {
    const next = firstObservation(note, ["next_step"]);
    const task = note.frontmatter?.task ? ` (${note.frontmatter.task})` : "";
    lines.push(`- [[${titleOf(note)}]]${task}${next ? ` → ${next}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * The block a session is handed at SessionStart.
 *
 * `stats` is the database's own summary, used for the time line; `vault` may
 * have no memory folder yet, in which case only the time summary is produced.
 */
export function buildBrief(vault, stats) {
  const blocks = [timeSummary(stats)];

  const rem = reminder(daysSinceLast(stats));
  if (rem) blocks.push(rem);

  // Ahead of the content, because a stale brief is worse than none: a reader
  // who does not know the record stopped will trust what it says.
  const health = captureHealthLine();
  if (health) blocks.push(health);

  // Same place and same reason: the verbatim record is only on this machine
  // until reflect promotes it (T-0386).
  const due = reflectDueLine(stats, { since: setupTime() });
  if (due) blocks.push(due);

  const store = hasStore(vault);
  if (store) {
    for (const block of [decisionBlock(vault), sessionBlock(vault)]) {
      if (block) blocks.push(block);
    }
  }

  // Last, and only once per session: how to use any of this. It goes after the
  // content because the content is what the session needs first, and it is
  // paid for here rather than on every prompt.
  const how = reflexes({
    hasStore: store,
    hasWritingNote: store && existsSync(join(vault, WRITING_NOTE)),
  });
  if (how) blocks.push(how);

  const text = blocks.join("\n\n");
  return text.length > LIMITS.chars ? `${text.slice(0, LIMITS.chars)}\n…` : text;
}
