// Task file bodies always have a "## Description" and "## Results" section (see
// vault-template/templates/task.md). The edit dialog only exposes the
// "## Description" text; "## Results" (and anything before "## Description") is
// preserved byte-for-byte so AI/human writeups there are never clobbered by the
// app.

const CONTENT_HEADER = "## Description";
const RESULT_HEADER = "## Results";

/** Default empty task body matching vault-template/templates/task.md. */
export const DEFAULT_BODY = "\n## Description\n\n## Results\n";

export interface ParsedBody {
  /** Everything before the content header, verbatim (usually a blank line). */
  before: string;
  /** Trimmed text of the content section, for editing. */
  content: string;
  /** The results header onward, verbatim — never edited by the dialog. */
  resultRaw: string;
  /** Whether both expected headers were found. */
  hasSections: boolean;
}

export function parseBody(body: string): ParsedBody {
  const contentIdx = body.indexOf(CONTENT_HEADER);
  const resultIdx = body.indexOf(RESULT_HEADER);
  if (contentIdx === -1 || resultIdx === -1 || resultIdx < contentIdx) {
    return { before: "", content: "", resultRaw: body, hasSections: false };
  }
  const contentRaw = body.slice(contentIdx + CONTENT_HEADER.length, resultIdx);
  const resultRaw = body.slice(resultIdx);
  const before = body.slice(0, contentIdx);
  return { before, content: contentRaw.trim(), resultRaw, hasSections: true };
}

export function buildBody(parsed: ParsedBody, newContent: string): string {
  if (!parsed.hasSections) {
    // No recognizable sections (unexpected external format) — append a
    // content section rather than guessing at a rewrite.
    return `${parsed.resultRaw}\n${CONTENT_HEADER}\n\n${newContent}\n`;
  }
  return `${parsed.before}${CONTENT_HEADER}\n\n${newContent}\n\n${parsed.resultRaw}`;
}
