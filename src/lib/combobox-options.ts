// Display-only decoration for the options of `src/components/ui/combobox.tsx`.
//
// The combobox commits the option string itself, never anything derived from
// what is drawn beside it. That separation is deliberate: a decorated label
// has to be un-decorated on the way back out, and a slip there silently
// rewrites the value (T-0219). Keeping the decoration in its own map means
// there is nothing to un-decorate — the label is read, never parsed.

/** What to draw beside one option value, and what the search should also
 * match on. Every field is display-only. */
export interface ComboboxOptionDetail {
  /** Shown after the option value, e.g. a backlog item's title. */
  label?: string;
  /** Shown after the label in a dimmer style, e.g. an item's status. */
  meta?: string;
}

/** Decoration keyed by option value. Options with no entry render bare, which
 * is what keeps the prop optional for the call sites that don't want it. */
export type ComboboxOptionDetails = Record<string, ComboboxOptionDetail>;

/**
 * The text cmdk filters an option on. It carries the label and meta as well as
 * the value so that typing "mindmap" finds `B-007` — an id-only list can only
 * be searched by someone who already knows the id, which is the one thing a
 * picker exists to spare you.
 *
 * cmdk passes this same string to `onSelect`, so a caller must commit the
 * option it closed over and never the value the item reports.
 */
export function optionSearchValue(
  option: string,
  detail?: ComboboxOptionDetail,
): string {
  return [option, detail?.label, detail?.meta]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}
