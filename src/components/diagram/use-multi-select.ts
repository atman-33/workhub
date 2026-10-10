import { useCallback, useState } from "react";
import { replaceSelected, toggleSelected, unionSelected } from "@/lib/diagram/multi-select";

/**
 * The selection state of a diagram canvas with multi-select (T-0716), shared
 * by every kind.
 *
 * The selection is an ordered id list; the last entry is the focused node the
 * side panel edits. A plain click replaces it, Shift+click toggles one id, a
 * marquee drag replaces it (or unions with Shift held). Clearing is Esc and a
 * click on empty canvas.
 */
export function useMultiSelect() {
  const [selected, setSelected] = useState<string[]>([]);

  /** A plain click on a node (or null for empty canvas). */
  const replace = useCallback((id: string | null) => {
    setSelected((prev) => {
      const next = replaceSelected(id);
      return next.length === prev.length && next.every((s, i) => s === prev[i]) ? prev : next;
    });
  }, []);

  /** Shift+click on a node. */
  const toggle = useCallback((id: string) => {
    setSelected((prev) => toggleSelected(prev, id));
  }, []);

  /** A marquee release: the caught ids replace, or join with Shift held. */
  const marquee = useCallback((caught: readonly string[], additive: boolean) => {
    setSelected((prev) => (additive ? unionSelected(prev, caught) : [...caught]));
  }, []);

  const clear = useCallback(() => {
    setSelected((prev) => (prev.length ? [] : prev));
  }, []);

  return { selected, setSelected, replace, toggle, marquee, clear };
}
