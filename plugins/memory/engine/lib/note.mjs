// Parsing a memory note into the three things it is made of.
//
// A note is Markdown with frontmatter, a body, categorized facts and typed
// links. Nothing here invents syntax: observations and relations are ordinary
// list items, which is what lets the owner write a note by hand and lets an
// agent read one back structurally.
//
//   ---
//   title: Rate limiting
//   type: decision
//   status: open
//   ---
//
//   # Rate limiting
//
//   Prose. The reasoning, what was tried, what it cost.
//
//   ## Observations
//   - [decision] Token bucket over a fixed window #api (per endpoint)
//   - [alternative] Fixed window, rejected: bursts at the boundary
//
//   ## Relations
//   - affects [[Public API]]
//   - supersedes [[Rate limiting v1]]
//
// The `## Observations` / `## Relations` headings are conventional, not
// required: both forms are recognized by their syntax anywhere in the note.

/** A line that is a task checkbox, not an observation. */
const CHECKBOX = /^[-*]\s+\[[ xX~-]\]\s/;
/** `- [text](url)` — a Markdown link, not an observation. */
const MD_LINK = /^[-*]\s+\[[^\]]*\]\(/;
/** `- [category] rest` */
const OBSERVATION = /^[-*]\s+\[([^\]()]+)\]\s*(.*)$/;
/** `- relation_type [[Target]]`, with the type optional. */
const RELATION = /^[-*]\s+(.*?)\s*\[\[([^\]]+)\]\]\s*(.*)$/;
/** Trailing `(context)`. */
const CONTEXT = /\(([^()]*)\)\s*$/;
const TAG = /#([^\s#]+)/g;

/**
 * Split frontmatter from the body.
 *
 * Deliberately a subset of YAML — `key: value` and `- item` lists, which is
 * all a note's frontmatter is allowed to be. A note that needs more than that
 * is a note that has stopped being readable by hand.
 */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { frontmatter: {}, body: text };

  const frontmatter = {};
  let listKey = null;
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      frontmatter[listKey].push(unquote(item[1]));
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === "") {
      // Either an empty scalar or the head of a list; the next line decides.
      frontmatter[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    const inline = /^\[(.*)\]$/.exec(value);
    frontmatter[key] = inline
      ? inline[1]
          .split(",")
          .map((v) => unquote(v.trim()))
          .filter(Boolean)
      : unquote(value);
  }
  // A key that opened a list and never got one is an empty scalar, not [].
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value) && value.length === 0) frontmatter[key] = "";
  }
  return { frontmatter, body: match[2] };
}

function unquote(value) {
  return value.replace(/^["'](.*)["']$/, "$1").trim();
}

/**
 * Every observation and relation in a note.
 *
 * @returns {{ frontmatter: object, body: string,
 *             observations: { category: string, text: string, tags: string[], context: string }[],
 *             relations: { type: string, target: string, context: string }[] }}
 */
export function parseNote(text) {
  const { frontmatter, body } = parseFrontmatter(text);
  const observations = [];
  const relations = [];

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("-") && !line.startsWith("*")) continue;
    // A task list is a task list, not a fact about the note.
    if (CHECKBOX.test(line)) continue;

    const relation = RELATION.exec(line);
    if (relation) {
      const [, prefix, target, trailing] = relation;
      // `- [[Target]]` with no verb is still an edge; `relates_to` is the
      // weakest thing it can honestly mean.
      const type = prefix.replace(/^[-*]\s+/, "").trim() || "relates_to";
      relations.push({
        type,
        target: target.trim(),
        context: (CONTEXT.exec(trailing)?.[1] ?? "").trim(),
      });
      continue;
    }

    if (MD_LINK.test(line)) continue;
    const observation = OBSERVATION.exec(line);
    if (!observation) continue;
    const [, category, rest] = observation;
    const context = (CONTEXT.exec(rest)?.[1] ?? "").trim();
    const withoutContext = context ? rest.replace(CONTEXT, "") : rest;
    const tags = [...withoutContext.matchAll(TAG)].map((m) => m[1]);
    observations.push({
      category: category.trim(),
      text: withoutContext.replace(TAG, "").replace(/\s+/g, " ").trim(),
      tags,
      context,
    });
  }

  return { frontmatter, body, observations, relations };
}

/** Observation texts for one category, in document order. */
export function observationsOf(note, category) {
  return note.observations.filter((o) => o.category === category).map((o) => o.text);
}

/** Relation targets for one type, in document order. */
export function relationsOf(note, type) {
  return note.relations.filter((r) => r.type === type).map((r) => r.target);
}
