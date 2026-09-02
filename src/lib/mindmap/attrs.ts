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

import {
  COLORS,
  formatTags,
  nodeHasAttr,
  parseTags,
  TAGS_KEY,
  type AttrView,
  type Color,
  type MindmapNode,
} from "./parse";

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
 * `visible` is the note's `attr_chips` setting, and it decides **both**
 * questions: which keys are shown, and in what order. `"all"` — the default —
 * shows every attribute the node carries in alphabetical order; a list shows
 * exactly those keys, in the order they are listed; an empty list turns chips
 * off entirely.
 *
 * One setting rather than two because the answers are never independent: a
 * user who cares that `tags` comes first is already deciding which keys are
 * worth the space, and a separate order list would need a rule for every key
 * that appears in one and not the other.
 *
 * Alphabetical is the *fallback*, not a preference — it is only there so that
 * a map nobody has ordered draws the same way every time. It is also why
 * ordering was worth adding: `tags` sorts last by accident of spelling.
 *
 * Within one key the order is the file's own — the order the user typed the
 * tags in — which the parser and the editor both preserve.
 */
export function chipsOf(
  node: Pick<MindmapNode, "attrs">,
  visible: "all" | string[],
): AttrChip[] {
  const attrs = node.attrs;
  if (!attrs) return [];
  if (visible !== "all" && visible.length === 0) return [];

  const shown =
    visible === "all"
      ? Object.keys(attrs).sort()
      : // The listed order wins, and a key the node does not carry is simply
        // skipped — the list is the map's preference, not a claim about any
        // one node.
        visible.filter((k) => k in attrs);

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

/**
 * What the right-click menu on an attribute chip can do.
 *
 * A menu rather than more sidebar: these are all things wanted at the moment
 * of looking at a chip on the map, not while editing a node in the panel. The
 * canvas already arbitrates the right button — a press that stays put is a
 * menu, one that travels is a pan (`usePanDrag`) — so this costs no gesture.
 */
export type ChipAction = "filter" | "clearFilter" | "colorBy" | "remove" | "hideKey";

/** State a chip command is decided against. */
export interface ChipContext {
  /** How the map is currently being looked at. */
  view: AttrView;
  /** Every attribute key in the map, alphabetical — what `"all"` means. */
  keys: string[];
  /** The attributes of the node the chip belongs to. */
  attrs: Record<string, string> | undefined;
}

/**
 * The change a chip command makes: either a new way of looking at the map, or
 * a new attribute map for the node the chip sits on.
 */
export type ChipCommand =
  | { kind: "view"; patch: Partial<AttrView> }
  | { kind: "attrs"; attrs: Record<string, string> | undefined };

/**
 * Turns a menu command into the change it makes.
 *
 * Kept out of the component because this is where the decisions are — a tag
 * comes out of a list while any other attribute goes whole, `"all"` has to be
 * spelled out before one key can be taken away from it, and choosing the key
 * already being coloured by is how you stop colouring. None of that is about
 * React, and all of it is worth a test.
 */
export function chipCommand(action: ChipAction, chip: AttrChip, ctx: ChipContext): ChipCommand {
  switch (action) {
    case "filter":
      return { kind: "view", patch: { filter: { key: chip.key, value: chip.value } } };
    case "clearFilter":
      return { kind: "view", patch: { filter: null } };
    case "colorBy":
      // The same item is the way back out, so the menu never strands the map
      // in a colouring the user cannot see how to leave.
      return { kind: "view", patch: { color: ctx.view.color === chip.key ? "" : chip.key } };
    case "hideKey": {
      // "Everything except one" is not a state `"all"` can express, so it is
      // resolved into the actual key list first.
      const listed = ctx.view.chips === "all" ? ctx.keys : ctx.view.chips;
      return { kind: "view", patch: { chips: listed.filter((k) => k !== chip.key) } };
    }
    case "remove": {
      // Removing a tag takes that tag out of the list; removing anything else
      // takes the whole attribute, because its value *is* the chip.
      const next =
        chip.key === TAGS_KEY
          ? formatTags(parseTags(ctx.attrs?.[TAGS_KEY]).filter((t) => t !== chip.value))
          : "";
      return { kind: "attrs", attrs: setAttr(ctx.attrs, chip.key, next) };
    }
  }
}

// ---------------------------------------------------------------------------
// quick assignment
// ---------------------------------------------------------------------------

/**
 * How many values one key offers in the node menu before the rest are left to
 * the panel.
 *
 * A menu is for the handful of labels a map actually reuses — `prio`, a few
 * tags. Past that it stops being faster than the panel it was meant to save
 * you from, and a submenu that scrolls is worse than either.
 */
export const QUICK_ATTR_LIMIT = 8;

/** One value a node's menu can toggle. */
export interface QuickAttrOption {
  value: string;
  /** What the item reads as — the tag itself, or the bare value. */
  label: string;
  /** True when the node already carries it. */
  on: boolean;
}

/** The values offered for one key. */
export interface QuickAttrGroup {
  key: string;
  options: QuickAttrOption[];
  /** Values the cap left out, which the panel still reaches. */
  overflow: number;
}

/**
 * The map's attribute vocabulary, arranged as the menu offers it.
 *
 * Built from what the map already uses rather than from anything configured:
 * the point of the menu is to repeat a label onto the next twenty nodes, and
 * a label nobody has typed yet is a job for the panel.
 *
 * A value the node already carries is never cut by the cap. Offering no way
 * to take a label back off would be worse than offering fewer to put on, and
 * the menu is the only place a label can be removed without opening the panel.
 */
export function quickAttrGroups(
  vocabulary: readonly { key: string; values: readonly string[] }[],
  attrs: Record<string, string> | undefined,
  limit: number = QUICK_ATTR_LIMIT,
): QuickAttrGroup[] {
  const groups: QuickAttrGroup[] = [];
  for (const { key, values } of vocabulary) {
    if (values.length === 0) continue;
    const on = values.filter((v) => nodeHasAttr({ attrs }, key, v));
    const off = values.filter((v) => !on.includes(v));
    const room = Math.max(0, limit - on.length);
    const kept = new Set([...on, ...off.slice(0, room)]);
    groups.push({
      key,
      // The vocabulary's own order is kept, so an item does not move under the
      // pointer when a sibling node has a different set of labels on it.
      options: values
        .filter((v) => kept.has(v))
        .map((value) => ({
          value,
          label: key === TAGS_KEY ? value : `${key}: ${value}`,
          on: on.includes(value),
        })),
      overflow: values.length - kept.size,
    });
  }
  return groups;
}

/**
 * Puts one value on a node, or takes it off again.
 *
 * `tags` gains and loses members; every other key is single-valued, so
 * choosing a second value replaces the first rather than accumulating — which
 * is the whole reason a scale like `prio` is a key and not a tag.
 */
export function quickAttrToggle(
  attrs: Record<string, string> | undefined,
  key: string,
  value: string,
): Record<string, string> | undefined {
  if (key !== TAGS_KEY) {
    return setAttr(attrs, key, attrs?.[key] === value ? "" : value);
  }
  const tags = parseTags(attrs?.[TAGS_KEY]);
  const next = tags.includes(value) ? tags.filter((t) => t !== value) : [...tags, value];
  return setAttr(attrs, TAGS_KEY, formatTags(next));
}

// ---------------------------------------------------------------------------
// chip order
// ---------------------------------------------------------------------------

/**
 * Collapses an explicit chip list back to `"all"` when it says the same thing.
 *
 * The frontmatter only carries `attr_chips` once the map wants something other
 * than the default, so a map nobody has reordered keeps a clean header.
 */
export function normalizeChips(next: string[], keys: string[]): "all" | string[] {
  const isDefault = next.length === keys.length && next.every((k, i) => k === keys[i]);
  return isDefault ? "all" : next;
}

/**
 * The order a node's own attribute keys are listed in.
 *
 * The same order the chips are drawn in, which is the point: the panel and the
 * canvas were disagreeing — the panel sorted alphabetically while the canvas
 * followed `attr_chips` — so a map that had been deliberately ordered read one
 * way on the node and another in the sidebar.
 *
 * A key the map hides (`attr_chips` names others) has no drawing order to
 * follow, so it goes last, alphabetically. It is still editable: hiding a chip
 * says nothing about whether the value matters.
 */
export function orderedAttrKeys(
  nodeKeys: readonly string[],
  chips: "all" | string[],
  mapKeys: readonly string[],
): string[] {
  const drawn = chips === "all" ? mapKeys : chips;
  const inOrder = drawn.filter((k) => nodeKeys.includes(k));
  const rest = nodeKeys.filter((k) => !inOrder.includes(k)).sort();
  return [...inOrder, ...rest];
}

/**
 * Moves one key in front of or behind another in the map's drawing order.
 *
 * Takes the **whole** list rather than the keys of the node being edited: the
 * order belongs to the map, and rewriting it from one node's attributes would
 * drop every key that node happens not to carry — hiding other nodes' chips as
 * a side effect of a drag that only meant to swap two rows.
 */
export function moveChipKey(
  chips: "all" | string[],
  mapKeys: string[],
  key: string,
  before: string,
): "all" | string[] {
  const full = chips === "all" ? [...mapKeys] : [...chips];
  const from = full.indexOf(key);
  const to = full.indexOf(before);
  if (from === -1 || to === -1 || from === to) return chips;
  full.splice(from, 1);
  full.splice(to, 0, key);
  return normalizeChips(full, mapKeys);
}
