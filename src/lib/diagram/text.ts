/**
 * Text measurement shared by every diagram kind.
 *
 * A table, not a canvas measurement: the screen, the HTML export and the PNG
 * export must put a box exactly where the app did, on any machine.
 */

/** Horizontal padding inside a node box; `wrapTitle` budgets for it. */
export const NODE_PAD_X = 12;
const PAD_X = NODE_PAD_X;
/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.45;

// ---------------------------------------------------------------------------
// text measurement
// ---------------------------------------------------------------------------

/**
 * Approximate advance width of one character at font size 1.
 *
 * Deliberately a table and not a canvas measurement: an export rendered on a
 * machine with different fonts must place its boxes exactly where the app did,
 * and `measureText` cannot promise that. The numbers are the usual ratios for
 * a UI sans-serif, rounded generously so a box is never too small for its
 * text.
 */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  // CJK, kana, and full-width forms occupy a full em.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 1;
  }
  if (ch === " ") return 0.28;
  if (/[iljtfIr.,;:'`|!]/.test(ch)) return 0.3;
  if (/[A-Z@%&WM]/.test(ch)) return 0.68;
  return 0.55;
}

export function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * fontSize;
}

/**
 * Splits a title into lines that fit `maxWidth`.
 *
 * Breaks on spaces where it can and mid-word where it cannot — a long URL or
 * an unspaced Japanese phrase must still fit the box rather than overflow it.
 */
export function wrapTitle(title: string, maxWidth: number, fontSize: number): string[] {
  const text = title.trim();
  if (!text) return [""];
  const limit = Math.max(maxWidth - PAD_X * 2, fontSize * 2);

  const lines: string[] = [];
  let line = "";
  const flush = () => {
    if (line) lines.push(line);
    line = "";
  };
  // Keep the spaces attached to the word before them, so a break never
  // produces a line that starts with a space.
  const words = text.split(/(?<=\s)/);
  for (const word of words) {
    const candidate = line + word;
    if (textWidth(candidate.trimEnd(), fontSize) <= limit || !line) {
      // A single word that is itself too long is split character by character.
      if (!line && textWidth(word.trimEnd(), fontSize) > limit) {
        let chunk = "";
        for (const ch of word) {
          if (textWidth(chunk + ch, fontSize) > limit && chunk) {
            lines.push(chunk);
            chunk = "";
          }
          chunk += ch;
        }
        line = chunk;
        continue;
      }
      line = candidate;
      continue;
    }
    flush();
    line = word;
  }
  flush();
  return lines.length ? lines.map((l) => l.trimEnd()) : [""];
}


/** Cuts `text` to fit `maxWidth`, ending in an ellipsis when it had to cut. */
export function truncateText(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  let out = "";
  for (const ch of text) {
    if (textWidth(`${out}${ch}…`, fontSize) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}
