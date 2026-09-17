/**
 * Turn `profile/decision-log.md` into one typed note per decision under
 * `memory/notes/`.
 *
 * The log held the owner's settled calls as one-liners under `## Decisions` —
 * grepped, never read whole. That is precisely the "reached by search" channel,
 * which is what `memory/notes/` is, so the log stops being a file and becomes
 * notes findable by `type: decision` like everything else (T-0374).
 *
 * They are written `status: accepted`: these are records of calls already made,
 * not decisions still in play. It is also why the note validator only requires
 * `[rationale]` and `[alternative]` while a decision is *open* — most log
 * entries never captured a rejected option, and demanding one retroactively
 * would fail a hundred notes over content that cannot now be recovered.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Written into every generated note. It is how the migration knows it has
 * already run: the source log is deliberately left in place, so its existence
 * cannot be the signal.
 */
export const MARKER = "migrated_from: profile/decision-log.md";

/**
 * `- YYYY-MM-DD [T-NNNN] <rule…>` and everything under it until the next such
 * line — an entry's `(from: …)` sits on a continuation line and belongs to it.
 *
 * Deliberately not `/m`: under that flag the trailing `$` matches at every line
 * end, so the lazy body stops at the first newline and every continuation line
 * is dropped. Without it, `^` and `$` mean the whole string, which is what the
 * lookahead needs.
 */
const ENTRY = /(?:^|\n)- (\d{4}-\d{2}-\d{2})(?: (T-\d+))? ([\s\S]*?)(?=\n- \d{4}-\d{2}-\d{2}|\n## |$)/g;

export function sourcePath(vault) {
  return join(vault, "profile", "decision-log.md");
}

export function targetDir(vault) {
  return join(vault, "memory", "notes");
}

/** Has this already been done? One generated note carrying the marker is enough. */
export function alreadyMigrated(vault) {
  const dir = targetDir(vault);
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    try {
      if (readFileSync(join(dir, name), "utf8").includes(MARKER)) return true;
    } catch {
      // unreadable note — it is not evidence either way, so keep looking
    }
  }
  return false;
}

function slugify(s) {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "decision"
  );
}

/** Split the rule from its trailing `(from: …)`, which is the context. */
function split(raw) {
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const from = [];
  const rule = [];
  let inFrom = false;
  for (const line of lines) {
    if (line.startsWith("(from:")) inFrom = true;
    (inFrom ? from : rule).push(line);
  }
  return {
    rule: rule.join(" ").replace(/\s+/g, " ").trim(),
    context: from
      .join(" ")
      .replace(/^\(from:\s*/, "")
      .replace(/\)$/, "")
      .trim(),
  };
}

/**
 * A title is one line of free prose, so it can hold a colon, a quote or a `#`.
 * Always quoting it keeps the frontmatter parseable whatever the owner wrote.
 */
function yamlString(s) {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function titleOf(rule) {
  return rule.length > 70 ? `${rule.slice(0, 70)}…` : rule;
}

/**
 * The notes this log would become.
 *
 * @returns {{ path: string, content: string }[]} — empty when there is no log.
 */
export function deriveNotes(vault) {
  const source = sourcePath(vault);
  if (!existsSync(source)) return [];

  const text = readFileSync(source, "utf8");
  const start = text.indexOf("## Decisions");
  if (start < 0) return [];
  const body = text.slice(start);

  const seen = new Set();
  const notes = [];
  for (const [, date, task, raw] of body.matchAll(ENTRY)) {
    const { rule, context } = split(raw);
    if (!rule) continue;

    // Titles collide — two calls on the same subject a month apart — so the
    // date disambiguates rather than one note silently overwriting the other.
    let slug = slugify(rule);
    if (seen.has(slug)) slug = `${slug}-${date}`;
    seen.add(slug);

    const title = titleOf(rule);
    notes.push({
      path: join(targetDir(vault), `${slug}.md`),
      content: `${[
        "---",
        `title: ${yamlString(title)}`,
        "type: decision",
        "status: accepted",
        `decided: ${date}`,
        ...(task ? [`task: ${task}`] : []),
        MARKER,
        "tags:",
        "  - decision",
        "---",
        "",
        `# ${title}`,
        "",
        `A call settled on ${date}, migrated from the decision log (T-0374).`,
        "",
        "## Observations",
        `- [decision] ${rule}`,
        ...(context ? [`- [context] ${context}`] : []),
        "",
      ].join("\n")}`,
    });
  }
  return notes;
}
