/**
 * The symbols of an architecture diagram (`type: architecture`), as a registry
 * (T-0709).
 *
 * A block's shape is decided by a `^mark` on its line, as in the other kinds;
 * a line with no mark (or an explicit `^block`) is a plain block. The registry
 * is the whole definition of a symbol: its mark, the shape it is drawn with
 * and where the title goes. Nothing in the parser, layout, canvas or export
 * names a particular kind, so adding a symbol is adding one entry here.
 *
 * A `^word` that is not in the registry is part of the title, so a note written
 * with a newer mark still opens.
 */
import type { Locale } from "../../i18n";

export interface ArchitectureSymbol {
  /** Stable machine name; what the model calls the kind. */
  kind: string;
  /** The `^mark` written on the node's line. `^block` is also accepted for a block. */
  mark: string;
  /** Id of the shape in the shape registry (`shapes.ts`). */
  shape: string;
  /** What the editor calls the symbol, per language. */
  label: Record<Locale, string>;
  /** Where the title is written: under the icon (people) or in the middle. */
  text: "below-icon" | "middle";
  /** Outline width in px. */
  strokeWidth: number;
}

export const SYMBOLS = [
  {
    kind: "block",
    mark: "^block",
    shape: "rect",
    label: { en: "Block", ja: "ブロック" },
    text: "middle",
    strokeWidth: 1.5,
  },
  {
    kind: "round",
    mark: "^round",
    shape: "rounded",
    label: { en: "Rounded block", ja: "角丸ブロック" },
    text: "middle",
    strokeWidth: 1.5,
  },
  {
    kind: "db",
    mark: "^db",
    shape: "cylinder",
    label: { en: "Database", ja: "データベース" },
    text: "middle",
    strokeWidth: 1.5,
  },
  {
    kind: "user",
    mark: "^user",
    shape: "person",
    label: { en: "Person", ja: "人" },
    text: "below-icon",
    strokeWidth: 1.5,
  },
  {
    kind: "cloud",
    mark: "^cloud",
    shape: "cloud",
    label: { en: "Cloud service", ja: "クラウド" },
    text: "middle",
    strokeWidth: 1.5,
  },
] as const satisfies readonly ArchitectureSymbol[];

export type NodeKind = (typeof SYMBOLS)[number]["kind"];
export const NODE_KINDS = SYMBOLS.map((s) => s.kind) as readonly NodeKind[];

/** The kind a node gets when nothing says otherwise. It is written without a mark. */
export const DEFAULT_KIND: NodeKind = "block";

const BY_KIND = new Map<string, ArchitectureSymbol>(SYMBOLS.map((s) => [s.kind, s]));
const BY_MARK = new Map<string, ArchitectureSymbol>(SYMBOLS.map((s) => [s.mark, s]));

export function symbolOfKind(kind: string): ArchitectureSymbol {
  return BY_KIND.get(kind) ?? BY_KIND.get(DEFAULT_KIND)!;
}

/** The symbol a `^mark` token names, or `undefined` when it is not a mark of this build. */
export function symbolOfMark(token: string): ArchitectureSymbol | undefined {
  return BY_MARK.get(token);
}

/** Shape id a node of `kind` is drawn with. */
export function shapeOfKind(kind: string): string {
  return symbolOfKind(kind).shape;
}

/** The mark a node of `kind` is written with; `""` for the default (a block has none). */
export function markOfKind(kind: string): string {
  return kind === DEFAULT_KIND ? "" : symbolOfKind(kind).mark;
}
