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
  /** Trimmed text of the content section, for editing. */
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
  /** Whether both required headers (Description, Results) were found. */
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

export function parseBody(body: string): ParsedBody {
  const { description: contentIdx, plan: planIdx, results: resultIdx } = findHeaderIndices(body);
  if (contentIdx === -1 || resultIdx === -1 || resultIdx < contentIdx) {
    return { before: "", content: "", plan: "", planRaw: "", resultRaw: body, hasSections: false };
  }
  const hasPlan = planIdx !== -1 && planIdx > contentIdx && planIdx < resultIdx;
  const contentEnd = hasPlan ? planIdx : resultIdx;
  const contentRaw = body.slice(contentIdx + CONTENT_HEADER.length, contentEnd);
  const planRaw = hasPlan ? body.slice(planIdx, resultIdx) : "";
  const plan = hasPlan ? planRaw.slice(PLAN_HEADER.length).trim() : "";
  const resultRaw = body.slice(resultIdx);
  const before = body.slice(0, contentIdx);
  return { before, content: contentRaw.trim(), plan, planRaw, resultRaw, hasSections: true };
}

export function buildBody(parsed: ParsedBody, newContent: string): string {
  if (!parsed.hasSections) {
    // No recognizable sections (unexpected external format) — append a
    // content section rather than guessing at a rewrite.
    return `${parsed.resultRaw}\n${CONTENT_HEADER}\n\n${newContent}\n`;
  }
  return `${parsed.before}${CONTENT_HEADER}\n\n${newContent}\n\n${parsed.planRaw}${parsed.resultRaw}`;
}
