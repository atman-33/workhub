/**
 * The symbols of a use case diagram (`type: usecase`), as a registry (T-0706).
 *
 * A node's kind is decided by a `^mark` on its line, as in the other kinds; a
 * line with no mark is a person. The registry is the whole definition of a
 * symbol: its mark, the shape it is drawn with, how it is drawn (stroke, dash),
 * whether it sits in the middle or on the ring, and whether its note is a
 * speech bubble. Nothing in the parser, layout, canvas or export names a
 * particular kind, so adding a symbol is adding one entry here.
 *
 * A `^word` that is not in the registry is part of the title, so a note written
 * with a newer mark still opens.
 */
import type { Locale } from "../../i18n";

export interface UsecaseSymbol {
  /** Stable machine name; what the model calls the kind. */
  kind: string;
  /** The `^mark` written on the node's line. `^person` is also accepted for a person. */
  mark: string;
  /** Id of the shape in the shape registry (`shapes.ts`). */
  shape: string;
  /** What the editor calls the symbol, per language. */
  label: Record<Locale, string>;
  /** Sits in the middle (systems, in a row) rather than on the ring. */
  centre: boolean;
  /** Its note is an always-visible speech bubble of bullet items (people). Otherwise the note is a hover memo. */
  bubble: boolean;
  /** Where the title is written: under the icon (people), at the top of the box (systems) or in the middle. */
  text: "below-icon" | "top" | "middle";
  /** Outline width in px. */
  strokeWidth: number;
  /** `stroke-dasharray`, when the outline is dashed. */
  dash?: string;
}

export const SYMBOLS = [
  {
    kind: "person",
    mark: "^person",
    shape: "person",
    label: { en: "Person", ja: "人" },
    centre: false,
    bubble: true,
    text: "below-icon",
    strokeWidth: 1.5,
  },
  {
    kind: "system",
    mark: "^system",
    shape: "rect",
    label: { en: "System", ja: "システム" },
    centre: true,
    bubble: false,
    text: "top",
    strokeWidth: 2.5,
  },
  {
    kind: "ext",
    mark: "^ext",
    shape: "rounded",
    label: { en: "External service", ja: "外部サービス" },
    centre: false,
    bubble: false,
    text: "middle",
    strokeWidth: 1.5,
    dash: "6 4",
  },
] as const satisfies readonly UsecaseSymbol[];

export type NodeKind = (typeof SYMBOLS)[number]["kind"];
export const NODE_KINDS = SYMBOLS.map((s) => s.kind) as readonly NodeKind[];

/** The kind a node gets when nothing says otherwise. It is written without a mark. */
export const DEFAULT_KIND: NodeKind = "person";

const BY_KIND = new Map<string, UsecaseSymbol>(SYMBOLS.map((s) => [s.kind, s]));
const BY_MARK = new Map<string, UsecaseSymbol>(SYMBOLS.map((s) => [s.mark, s]));

export function symbolOfKind(kind: string): UsecaseSymbol {
  return BY_KIND.get(kind) ?? BY_KIND.get(DEFAULT_KIND)!;
}

/** The symbol a `^mark` token names, or `undefined` when it is not a mark of this build. */
export function symbolOfMark(token: string): UsecaseSymbol | undefined {
  return BY_MARK.get(token);
}

/** Shape id a node of `kind` is drawn with. */
export function shapeOfKind(kind: string): string {
  return symbolOfKind(kind).shape;
}

/** The mark a node of `kind` is written with; `""` for the default (a person has none). */
export function markOfKind(kind: string): string {
  return kind === DEFAULT_KIND ? "" : symbolOfKind(kind).mark;
}
