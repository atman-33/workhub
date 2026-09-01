/**
 * Line endings for the vault notes the app parses and rewrites.
 *
 * The note parsers (`lib/schedule/parse.ts`, `lib/mindmap/parse.ts`) are
 * line-oriented, and several of their patterns end in `(.*)$`. In JavaScript
 * `.` does not match `\r` — it is a line terminator — and a non-multiline `$`
 * tolerates only a trailing `\n`, so every one of those patterns fails on a
 * file saved with Windows line endings and the whole note reads as
 * unrecognized text.
 *
 * Rather than harden pattern after pattern, the conversion happens once at the
 * boundary: a parser normalizes what it was handed, and a serializer writes
 * back whatever the file was already using. Notes in this vault are shared with
 * Obsidian, with git (which may check them out as CRLF) and with a human's own
 * editor, so the app is not entitled to an opinion about which ending a file
 * should have — only to leave it as it found it.
 */

export type Eol = "\n" | "\r\n";

/**
 * The line ending a file is written with.
 *
 * The first `\r\n` decides for the whole file. A note with mixed endings — the
 * usual result of two editors disagreeing — is normalized to one on the next
 * save, which is a repair rather than a loss.
 */
export function detectEol(content: string): Eol {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/** Strips `\r` from `\r\n`, so the rest of a parser only ever sees `\n`. */
export function toLf(content: string): string {
  return content.includes("\r\n") ? content.split("\r\n").join("\n") : content;
}

/** Puts a file's own line ending back on text that was worked on as LF. */
export function withEol(content: string, eol: Eol): string {
  return eol === "\n" ? content : content.split("\n").join("\r\n");
}
