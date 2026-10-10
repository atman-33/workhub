/**
 * Which side panels of the Diagrams tab are hidden (T-0686).
 *
 * Every kind of diagram has a left panel (the note list) and a right panel
 * (the editor of the selected element). The owner can hide either, per kind.
 * The choice is stored as `diagram_hidden_panels` in the vault settings: a
 * list of `<kind>:<side>` entries. A panel is open unless its entry is there,
 * so a kind or side this build does not know about is simply never asked for.
 */

export type PanelSide = "left" | "right";

const entry = (kind: string, side: PanelSide) => `${kind}:${side}`;

export function isPanelOpen(
  hidden: readonly string[],
  kind: string,
  side: PanelSide,
): boolean {
  return !hidden.includes(entry(kind, side));
}

/** The list with one panel opened or hidden; the input list is not changed. */
export function withPanelOpen(
  hidden: readonly string[],
  kind: string,
  side: PanelSide,
  open: boolean,
): string[] {
  const key = entry(kind, side);
  const rest = hidden.filter((h) => h !== key);
  return open ? rest : [...rest, key];
}
