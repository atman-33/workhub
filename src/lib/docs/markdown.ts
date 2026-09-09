/**
 * Markdown preprocessing for the Docs tab (T-0259).
 *
 * The documents being browsed are written in Obsidian by the team, so they
 * carry Obsidian's own embed syntax, which CommonMark knows nothing about.
 * These are pure string/path functions — kept out of the React components so
 * the awkward cases (spaces in filenames, `../`, percent-encoding) can be
 * pinned down by tests instead of by looking at a preview.
 */

/** True for a source the preview must hand to the browser untouched. */
export function isExternalSrc(src: string): boolean {
  return /^(https?:|data:|blob:|mailto:|#)/i.test(src.trim());
}

/**
 * Rewrites Obsidian's `![[file]]` embeds into CommonMark images.
 *
 * `![[a.png]]` → `![](<a.png>)`, `![[a.png|caption]]` → `![caption](<a.png>)`.
 * The target is wrapped in angle brackets because these filenames routinely
 * contain spaces — `![](my note.png)` does not parse as an image.
 *
 * Only *image* embeds are converted. `![[some note]]` embedding another
 * document is left as literal text: pulling a second file in would mean a
 * second network read per embed, and the tab does not follow document links
 * at all yet.
 *
 * Code spans and fenced blocks are skipped, so a document *about* the syntax
 * still shows it.
 */
export function expandWikiEmbeds(markdown: string): string {
  return mapOutsideCode(markdown, (text) =>
    text.replace(/!\[\[([^\]|#]+?)(?:#[^\]|]*?)?(?:\|([^\]]*?))?\]\]/g, (whole, target, label) => {
      const path = String(target).trim();
      if (!isEmbeddableImage(path)) return whole;
      // A caption of "300" (Obsidian's width syntax) is a size, not a label.
      const alt = label && !/^\d+(x\d+)?$/.test(String(label).trim()) ? String(label).trim() : "";
      return `![${alt}](<${path}>)`;
    }),
  );
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

function isEmbeddableImage(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Applies `fn` to the parts of `markdown` that are not code.
 *
 * Fenced blocks (``` / ~~~) and inline code spans are passed through
 * unchanged — the alternative is a preview that silently rewrites the very
 * syntax a document is documenting.
 */
function mapOutsideCode(markdown: string, fn: (text: string) => string): string {
  const out: string[] = [];
  let rest = markdown;
  // Either a fenced block (from its opening fence to the matching one, or to
  // the end of the file when it is never closed) or an inline code span.
  const code = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)|`[^`\n]*`/;
  for (;;) {
    const match = code.exec(rest);
    if (!match) break;
    out.push(fn(rest.slice(0, match.index)), match[0]);
    rest = rest.slice(match.index + match[0].length);
  }
  out.push(fn(rest));
  return out.join("");
}

/** The directory a document lives in, forward slashes, no trailing slash. */
export function dirOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const cut = norm.lastIndexOf("/");
  return cut <= 0 ? norm : norm.slice(0, cut);
}

/**
 * Resolves an image reference against the document that embeds it.
 *
 * Returns `null` for a source the backend must not be asked about — an
 * external URL, or an empty reference. Absolute paths are passed through: the
 * containment guard on the backend is what decides whether one is allowed,
 * and duplicating that judgement here would only let the two disagree.
 */
export function resolveDocRelative(docPath: string, src: string): string | null {
  const raw = src.trim().replace(/^<|>$/g, "");
  if (!raw || isExternalSrc(raw)) return null;
  // Markdown sources are percent-encoded by most editors; the filesystem
  // wants the real name back.
  let target = raw;
  try {
    target = decodeURI(raw);
  } catch {
    // A stray `%` that is not an escape — take the source as typed.
  }
  target = target.replace(/\\/g, "/");
  const absolute = /^([a-zA-Z]:\/|\/\/|\/)/.test(target);
  const joined = absolute ? target : `${dirOf(docPath)}/${target}`;
  return normalizeSlashPath(joined);
}

/**
 * Collapses `.` and `..` segments, keeping whatever root the path starts with
 * — a UNC `//server`, a `C:/` drive, or a leading `/`.
 */
export function normalizeSlashPath(path: string): string {
  let prefix = "";
  let rest = path;
  if (rest.startsWith("//")) {
    prefix = "//";
    rest = rest.slice(2);
  } else if (/^[a-zA-Z]:\//.test(rest)) {
    prefix = rest.slice(0, 3);
    rest = rest.slice(3);
  } else if (rest.startsWith("/")) {
    prefix = "/";
    rest = rest.slice(1);
  }
  const out: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Never climb past the root. The backend's guard would reject such a
      // path anyway, and a half-climbed one makes for a worse error message.
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(segment);
  }
  return prefix + out.join("/");
}
