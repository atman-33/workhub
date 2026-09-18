/**
 * Fingerprints of files the vault template has shipped, so a migration can
 * tell boilerplate from the owner's own writing.
 *
 * This is the one question a migration can answer about content, and it is
 * the only one it needs. "Which of these two files is the real one?" has no
 * general answer — both could have been written by hand. "Is this file
 * byte-for-byte something we shipped?" does, and every collision a migration
 * meets reduces to it.
 *
 * The hard case that made this necessary: after T-0376 moved `profile/` to
 * `memory/identity/` and the owner deleted `profile/`, an older app started,
 * found its `seed_only` files missing, and seeded them back. The runner then
 * saw `profile/about-me.md` (boilerplate) colliding with
 * `memory/identity/about-me.md` (the owner's), assumed the destination was
 * the seed, and would have moved the owner's note aside in favour of the
 * template's (T-0380).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * sha256 of the file with line endings normalized.
 *
 * Normalized because git on Windows checks the template out with CRLF while
 * the repository holds LF, so the same shipped file arrives in two byte forms
 * and only one of them would ever match.
 */
export function fingerprint(path) {
  const text = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Is this file exactly one of the given template versions? */
export function isTemplate(path, known) {
  if (!known?.size) return false;
  try {
    return known.has(fingerprint(path));
  } catch {
    // Unreadable: it is not evidence of being boilerplate, so treat it as
    // the owner's. The safe direction for every caller is "do not touch".
    return false;
  }
}
