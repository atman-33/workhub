/**
 * Attribute chips: turning a node's `key:value` attributes into the small
 * labels the canvas and the exports draw under its title.
 *
 * Kept apart from `layout.ts` on purpose. What a chip *is* — which attributes
 * are visible, what each one reads as, what colour it takes — is a question
 * about the document, and the answer has to be identical on screen, in the PNG
 * and in the HTML export. Where a chip is *placed* is a layout question and
 * lives next to the rest of the geometry.
 *
 * This module therefore has no dependency on layout, which is also what keeps
 * the import graph acyclic: layout imports chips, never the other way round.
 */

import { COLORS, TAGS_KEY, parseTags, type Color, type MindmapNode } from "./parse";

/** One label drawn under a node. */
export interface AttrChip {
  /** Attribute key this chip came from. */
  key: string;
  /**
   * The single value this chip stands for. For `tags` that is one tag, not
   * the whole comma-joined attribute — a chip per tag is the only rendering
   * in which "which tags does this node have" is answerable at a glance.
   */
  value: string;
  /** What the chip reads as. */
  label: string;
  /** Fill colour, derived from the value. */
  color: Color;
}

/**
 * A stable colour for an attribute value.
 *
 * Hashed rather than assigned in order of appearance: the same value must take
 * the same colour in the app, in an export made a month later, and in a second
 * map that uses the same vocabulary. Order of appearance gives none of that,
 * and a declared palette in the frontmatter would be one more thing to
 * maintain before the feature does anything useful.
 *
 * The consequence is that the mapping is arbitrary — `high` is not
 * red-because-high. That is the honest trade: the colours separate values,
 * they do not rank them.
 */
export function attrValueColor(value: string): Color {
  // FNV-1a, which is short, has no dependencies and spreads short ASCII and
  // Japanese strings alike.
  let hash = 0x811c9dc5;
  for (const ch of value) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

/**
 * The colour a node takes when the map is coloured by `key`, or `undefined`
 * when the node does not carry that attribute.
 *
 * A node with no value for the key stays uncoloured rather than falling back
 * to its own `#color`: "not labelled yet" is the answer the user is looking
 * for when they colour by a key, and painting those nodes in the map's normal
 * colours would hide exactly them.
 *
 * A multi-tag node is coloured by its first tag. One box can only be one
 * colour, and the chips underneath still show the rest.
 */
export function attrColorFor(
  node: Pick<MindmapNode, "attrs">,
  key: string,
): Color | undefined {
  const raw = node.attrs?.[key];
  if (!raw) return undefined;
  const value = key === TAGS_KEY ? parseTags(raw)[0] : raw;
  return value ? attrValueColor(value) : undefined;
}

/**
 * Which attributes of a node are shown, in the order they are drawn.
 *
 * `visible` is the note's `attr_chips` setting: `"all"` (the default) shows
 * every attribute the node carries, a list narrows it to those keys, and an
 * empty list turns chips off entirely.
 */
export function chipsOf(
  node: Pick<MindmapNode, "attrs">,
  visible: "all" | string[],
): AttrChip[] {
  const attrs = node.attrs;
  if (!attrs) return [];
  if (visible !== "all" && visible.length === 0) return [];

  const keys = Object.keys(attrs).sort();
  const shown = visible === "all" ? keys : keys.filter((k) => visible.includes(k));

  const chips: AttrChip[] = [];
  for (const key of shown) {
    const raw = attrs[key];
    if (!raw) continue;
    if (key === TAGS_KEY) {
      // A tag reads as itself; prefixing it with `tags:` would spend the
      // chip's width on a word that is the same on every one of them.
      for (const tag of parseTags(raw)) {
        chips.push({ key, value: tag, label: tag, color: attrValueColor(tag) });
      }
      continue;
    }
    chips.push({ key, value: raw, label: `${key}: ${raw}`, color: attrValueColor(raw) });
  }
  return chips;
}

/**
 * Sets or clears one attribute, returning a new map.
 *
 * An empty value removes the key rather than storing `""`: the file has no way
 * to write a valueless attribute, so keeping one in memory would mean the
 * model and the note disagree until the next reload.
 */
export function setAttr(
  attrs: Record<string, string> | undefined,
  key: string,
  value: string,
): Record<string, string> | undefined {
  const next = { ...(attrs ?? {}) };
  if (value) next[key] = value;
  else delete next[key];
  return Object.keys(next).length ? next : undefined;
}
