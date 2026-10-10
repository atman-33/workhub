/**
 * The elements of an IFDAM diagram (`type: ifdam`), as a registry (T-0703).
 *
 * An IFDAM diagram draws one feature of an app: the screens, the triggers
 * (what the user does), the processes behind them, the data stores they read
 * and write and the messages they show. A node's kind is a `^mark` on its line
 * (`^screen`, `^trigger`, `^store`, `^message`); a line with no mark is a
 * process. Same contract as the program flow's registry: the entry is the whole
 * definition (mark, shape, name, what `+` adds next), and nothing else names a
 * particular kind, so adding an element is adding one entry here (and its shape
 * to `shapes.ts` when none fits). A `^word` that is not in the registry stays
 * part of the title.
 */
import type { Locale } from "../../i18n";

export interface IfdamSymbol {
  /** Stable machine name; what the model calls the kind. */
  kind: string;
  /** The `^mark` written on the node's line. `^process` is also accepted for a plain process. */
  mark: string;
  /** Id of the shape in the shape registry (`shapes.ts`). */
  shape: string;
  /** What the editor calls the element, per language. */
  label: Record<Locale, string>;
  /** The kind the editor's `+` adds after this one. */
  next: string;
}

export const SYMBOLS = [
  {
    kind: "screen",
    mark: "^screen",
    shape: "screen",
    label: { en: "Screen", ja: "画面" },
    next: "trigger",
  },
  {
    kind: "trigger",
    mark: "^trigger",
    shape: "hexagon",
    label: { en: "Trigger", ja: "トリガー" },
    next: "process",
  },
  {
    kind: "process",
    mark: "^process",
    shape: "ellipse",
    label: { en: "Process", ja: "処理" },
    next: "message",
  },
  {
    kind: "store",
    mark: "^store",
    shape: "cylinder",
    label: { en: "Data store", ja: "データストア" },
    next: "process",
  },
  {
    kind: "message",
    mark: "^message",
    shape: "rounded",
    label: { en: "Message", ja: "メッセージ" },
    next: "screen",
  },
] as const satisfies readonly IfdamSymbol[];

export type NodeKind = (typeof SYMBOLS)[number]["kind"];
export const NODE_KINDS = SYMBOLS.map((s) => s.kind) as readonly NodeKind[];

/** The kind a node gets when nothing says otherwise. It is written without a mark. */
export const DEFAULT_KIND: NodeKind = "process";

const BY_KIND = new Map<string, IfdamSymbol>(SYMBOLS.map((s) => [s.kind, s]));
const BY_MARK = new Map<string, IfdamSymbol>(SYMBOLS.map((s) => [s.mark, s]));

export function symbolOfKind(kind: string): IfdamSymbol {
  return BY_KIND.get(kind) ?? BY_KIND.get(DEFAULT_KIND)!;
}

/** The symbol a `^mark` token names, or `undefined` when it is not a mark of this build. */
export function symbolOfMark(token: string): IfdamSymbol | undefined {
  return BY_MARK.get(token);
}

/** Shape id a node of `kind` is drawn with. */
export function shapeOfKind(kind: string): string {
  return symbolOfKind(kind).shape;
}

/** The mark a node of `kind` is written with; `""` for the default (a process has none). */
export function markOfKind(kind: string): string {
  return kind === DEFAULT_KIND ? "" : symbolOfKind(kind).mark;
}

/** The kind the editor's `+` adds after a node of `kind`. */
export function nextKindOf(kind: string): NodeKind {
  return symbolOfKind(kind).next as NodeKind;
}
