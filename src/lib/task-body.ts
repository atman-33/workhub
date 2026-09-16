// Task file bodies have three sections, in order: "## Description",
// "## Plan", and "## Results" (see vault-template/templates/task.md). The
// edit dialog only exposes the "## Description" text.
//
// "## Plan" is the approved implementation plan — written by an AI agent
// (with human approval) or by hand in Obsidian, never by this app's edit
// dialog. It is optional: older task files predate it, and it must stay
// optional going forward — buildBody never injects a "## Plan" header where
// one did not already exist, or every task in the vault would gain a
// spurious empty section the first time it is saved from the app.
//
// "## Results" (and anything before "## Description") is preserved
// byte-for-byte so AI/human writeups there are never clobbered by the app.
//
// Header detection skips fenced code blocks (```), so a mermaid diagram or
// example snippet inside "## Plan" that happens to contain a line like
// "## Results" cannot be mistaken for the real section boundary.

const CONTENT_HEADER = "## Description";
const PLAN_HEADER = "## Plan";
const RESULT_HEADER = "## Results";

/** Default empty task body matching vault-template/templates/task.md. */
export const DEFAULT_BODY = "\n## Description\n\n## Plan\n\n## Results\n";

export interface ParsedBody {
  /** Everything before the content header, verbatim (usually a blank line). */
  before: string;
  /** Text of the content section, for editing: leading line breaks removed,
   *  trailing line breaks preserved up to MAX_TRAILING_NEWLINES (T-0365).
   *  Trailing spaces are never touched (T-0357). */
  content: string;
  /** Trimmed text of the Plan section (without its header); "" when the
   *  section is absent. Read-only in the app — surfaced for display only. */
  plan: string;
  /** The "## Plan" header through just before "## Results", verbatim; ""
   *  when no Plan section exists. buildBody carries this through unchanged
   *  so an approved plan round-trips byte-for-byte. */
  planRaw: string;
  /** The results header onward, verbatim — never edited by the dialog. */
  resultRaw: string;
  /** Whether the body was recognized as sectioned. True when
   *  "## Description" was found and either "## Results" follows it or the
   *  Description-only fallback applies (no "## Results" header at all). */
  hasSections: boolean;
}

/** Line-start indices of each section header, skipping fenced code blocks
 * (``` ... ```) so header-looking text inside a Plan's mermaid diagram or
 * example snippet is never mistaken for a real section boundary. -1 when a
 * header is not found (outside any fence). */
function findHeaderIndices(body: string): {
  description: number;
  plan: number;
  results: number;
} {
  let description = -1;
  let plan = -1;
  let results = -1;
  let inFence = false;
  let pos = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence) {
      if (description === -1 && trimmed === CONTENT_HEADER) description = pos;
      else if (plan === -1 && trimmed === PLAN_HEADER) plan = pos;
      else if (results === -1 && trimmed === RESULT_HEADER) results = pos;
    }
    pos += line.length + 1; // +1 for the newline consumed by split("\n")
  }
  return { description, plan, results };
}

/** Maximum trailing line breaks preserved in the Description draft (T-0365).
 *  Anything beyond this is capped on parse and on build, so holding Enter
 *  cannot grow unbounded blank lines in the file. */
export const MAX_TRAILING_NEWLINES = 3;

/** Remove leading line breaks only, preserving trailing spaces.
 *  In-progress list markers (`- `) and spaces-only lines must survive a
 *  file → draft round-trip: `trim()` deleted them, so the next vault sync
 *  rewrote the Textarea value under the user and the cursor jumped (T-0357). */
function stripLeadingNewlines(text: string): string {
  return text.replace(/^(\r?\n)+/, "");
}

/** Remove up to `max` trailing line breaks (the canonical blank-line
 *  separator before the next section header, or the EOF newline). Fewer
 *  available removes fewer — a hand-written file without the blank line
 *  still parses instead of eating into the text. */
function stripUpToTrailingNewlines(text: string, max: number): string {
  const m = text.match(/(\r?\n)+$/);
  if (!m) return text;
  const units = m[0].match(/\r?\n/g) ?? [];
  return text.slice(0, text.length - units.slice(-max).join("").length);
}

/** Cap trailing line breaks at `max`, preserving their exact CRLF/LF style. */
export function capTrailingNewlines(text: string, max: number): string {
  const m = text.match(/(\r?\n)+$/);
  if (!m) return text;
  const units = m[0].match(/\r?\n/g) ?? [];
  if (units.length <= max) return text;
  return text.slice(0, text.length - m[0].length) + units.slice(-max).join("");
}

/** Normalize a raw section slice for editing: drop leading line breaks,
 *  drop the canonical separator (`separatorSize`: 2 before the next header,
 *  1 for the EOF newline), then cap any remaining user trailing breaks. */
function normalizeContent(raw: string, separatorSize: number): string {
  const noLead = stripLeadingNewlines(raw);
  if (!noLead) return "";
  return capTrailingNewlines(
    stripUpToTrailingNewlines(noLead, separatorSize),
    MAX_TRAILING_NEWLINES,
  );
}

export function parseBody(body: string): ParsedBody {
  const { description: contentIdx, plan: planIdx, results: resultIdx } = findHeaderIndices(body);
  if (contentIdx === -1 || (resultIdx !== -1 && resultIdx < contentIdx)) {
    return { before: "", content: "", plan: "", planRaw: "", resultRaw: body, hasSections: false };
  }
  if (resultIdx === -1) {
    // Description-only fallback: a freshly filed task with no "## Results"
    // section yet. Treat everything after "## Description" (up to an optional
    // "## Plan", else end of file) as the description so the editor shows it
    // instead of an empty pane. No "## Results" header is invented here.
    const hasPlan = planIdx !== -1 && planIdx > contentIdx;
    const contentEnd = hasPlan ? planIdx : body.length;
    const contentRaw = body.slice(contentIdx + CONTENT_HEADER.length, contentEnd);
    const planRaw = hasPlan ? body.slice(planIdx) : "";
    const plan = hasPlan ? planRaw.slice(PLAN_HEADER.length).trim() : "";
    const before = body.slice(0, contentIdx);
    return { before, content: normalizeContent(contentRaw, hasPlan ? 2 : 1), plan, planRaw, resultRaw: "", hasSections: true };
  }
  const hasPlan = planIdx !== -1 && planIdx > contentIdx && planIdx < resultIdx;
  const contentEnd = hasPlan ? planIdx : resultIdx;
  const contentRaw = body.slice(contentIdx + CONTENT_HEADER.length, contentEnd);
  const planRaw = hasPlan ? body.slice(planIdx, resultIdx) : "";
  const plan = hasPlan ? planRaw.slice(PLAN_HEADER.length).trim() : "";
  const resultRaw = body.slice(resultIdx);
  const before = body.slice(0, contentIdx);
  return { before, content: normalizeContent(contentRaw, 2), plan, planRaw, resultRaw, hasSections: true };
}

export function buildBody(parsed: ParsedBody, newContent: string): string {
  // Cap first so a held-down Enter cannot pile unbounded blank lines into
  // the file; the templates below then re-attach the canonical separator
  // (blank line before the next header, EOF newline), which parse strips
  // back off — keeping parse → build → parse identical (T-0365).
  const capped = capTrailingNewlines(newContent, MAX_TRAILING_NEWLINES);
  if (!parsed.hasSections) {
    // No recognizable sections (unexpected external format) — append a
    // content section rather than guessing at a rewrite.
    return `${parsed.resultRaw}\n${CONTENT_HEADER}\n\n${capped}\n`;
  }
  const tail = `${parsed.planRaw}${parsed.resultRaw}`;
  if (!tail) {
    // Description-only body: no Plan or Results to carry through, and no
    // "## Results" header to invent — just the description section.
    return `${parsed.before}${CONTENT_HEADER}\n\n${capped}\n`;
  }
  return `${parsed.before}${CONTENT_HEADER}\n\n${capped}\n\n${parsed.planRaw}${parsed.resultRaw}`;
}
