/**
 * Markdown preprocessing for the Docs tab (T-0259).
 *
 * The documents being browsed are written in Obsidian by the team, so they
 * carry Obsidian's own embed syntax, which CommonMark knows nothing about.
 * These are pure string/path functions — kept out of the React components so
 * the awkward cases (spaces in filenames, `../`, percent-encoding) can be
 * pinned down by tests instead of by looking at a preview.
 */

/**
 * Splits a document's YAML frontmatter off its body (T-0294).
 *
 * Left in, the block is not merely unstyled — it is actively *mis*-read.
 * CommonMark has no frontmatter: the opening `---` is a thematic break, the
 * keys below it are a paragraph, and the closing `---` underlines that
 * paragraph into a setext **heading**. An Obsidian note therefore opened with
 * its own metadata set in headline type, the loudest thing on a page whose
 * point is the prose underneath.
 *
 * The block has to start at byte zero or it is a horizontal rule like any
 * other. Its content is returned as written rather than parsed: the preview
 * shows it as reference material, and a YAML parser here could only disagree
 * with the one in Obsidian.
 */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: "", body: text };
  return { frontmatter: match[1], body: text.slice(match[0].length) };
}

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
 * A parsed `[[wikilink]]` (T-0726): the file part the backend resolves, and
 * the text the reader clicks.
 *
 * `[[name]]` → both `name`; `[[name|alias]]` shows `alias`;
 * `[[name#heading]]` and `[[folder/name]]` keep working the way Obsidian
 * reads them — the `#heading` only scrolls within the note, and the preview
 * opens whole documents, so it is dropped for the lookup but kept for the
 * label, which defaults to the link as written.
 */
export interface WikiLinkParts {
  target: string;
  label: string;
}

export function parseWikiLink(inner: string): WikiLinkParts | null {
  const text = inner.trim();
  if (!text) return null;
  const bar = text.indexOf("|");
  const main = (bar < 0 ? text : text.slice(0, bar)).trim();
  const alias = bar < 0 ? "" : text.slice(bar + 1).trim();
  if (!main) return null;
  const hash = main.indexOf("#");
  const target = (hash < 0 ? main : main.slice(0, hash)).trim();
  if (!target) return null;
  return { target, label: alias || text };
}

/**
 * Encodes a wikilink target as the destination of the CommonMark link
 * `expandWikiLinks` writes. A scheme of its own (`wiki:`, percent-encoded)
 * rather than a relative path: the name is unresolvable until the backend —
 * the one place that can search the vault — is asked, which happens on click,
 * not on render.
 */
export function wikiHref(target: string): string {
  // Slashes stay bare so a `folder/name` still reads as a path; everything
  // else that would break a link destination is percent-encoded.
  return `wiki:${target.split("/").map(encodeURIComponent).join("/")}`;
}

/** Reads back what `wikiHref` wrote, or `null` for any other link. */
export function parseWikiHref(href: string): string | null {
  if (!/^wiki:/i.test(href.trim())) return null;
  const encoded = href.trim().slice("wiki:".length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    // A stray `%` that is not an escape — take the target as typed.
    return encoded;
  }
}

/**
 * Rewrites Obsidian's `[[wikilink]]` document links into CommonMark links.
 *
 * `[[name]]` → `[name](<wiki:name>)`, `[[name|alias]]` → `[alias](<wiki:name>)`.
 * The destination is wrapped in angle brackets because targets routinely
 * contain spaces; the label escapes its brackets so an alias cannot break out
 * of the link.
 *
 * Image and document embeds (`![[…]]`) are left alone — `expandWikiEmbeds`
 * owns those — as is anything inside code spans and fenced blocks, by way of
 * `mapOutsideCode`. An unresolvable link still becomes a link: clicking it is
 * what asks the backend, and a link with no answer shows the Obsidian hint
 * rather than failing the read.
 */
export function expandWikiLinks(markdown: string): string {
  return mapOutsideCode(markdown, (text) =>
    text.replace(
      /\[\[([^\][\n]+?)\]\]/g,
      (whole, inner, offset: number, full: string) => {
        // An embed marker, handled (or deliberately left) by expandWikiEmbeds.
        if (offset > 0 && full[offset - 1] === "!") return whole;
        const parts = parseWikiLink(String(inner));
        if (!parts) return whole;
        const label = parts.label
          .replace(/\\/g, "\\\\")
          .replace(/\[/g, "\\[")
          .replace(/\]/g, "\\]");
        return `[${label}](<${wikiHref(parts.target)}>)`;
      },
    ),
  );
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

/**
 * A tree path as Windows writes it — `C:\docs\a.md`, `\\server\share\a.md` —
 * which is what "Copy path" should put on the clipboard: it is going to be
 * pasted into Explorer, a terminal or a chat, not back into this tab. A path
 * that is neither a drive path nor UNC is returned as it is.
 */
export function toWindowsPath(path: string): string {
  return /^([a-zA-Z]:\/|\/\/)/.test(path) ? path.replace(/\//g, "\\") : path;
}

/** A path's last segment — the file name, extension included. */
export function basename(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm.slice(norm.lastIndexOf("/") + 1);
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
 * Resolves a link written in a document to the file it names, or `null` when
 * it is not a link to a file (T-0647): a web address, a bare `#fragment`, any
 * other scheme. A `#fragment` or `?query` after the file name is dropped — the
 * tab opens whole documents. The name is percent-decoded, so both
 * `a｜b.md` and the `a%EF%BD%9Cb.md` an editor writes reach the real file.
 */
export function resolveDocLink(docPath: string, href: string): string | null {
  const raw = href.trim();
  if (!raw || /^([a-z][a-z0-9+.-]+:|#)/i.test(raw)) return null;
  const file = raw.replace(/^<|>$/g, "").replace(/[#?].*$/, "");
  return file ? resolveDocRelative(docPath, file) : null;
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
