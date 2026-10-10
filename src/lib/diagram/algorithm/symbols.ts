/**
 * The symbols of a program flow chart (`type: algorithm`), as a registry
 * (T-0698).
 *
 * A node's kind is decided by a `^mark` on its line (`^start`, `^decision`, ...),
 * the same way a business-flow step's is; a line with no mark is a process. The
 * registry is the whole definition of a symbol - its mark, a name, the shape it
 * is drawn with and what the editor calls it - and nothing else in the parser,
 * layout, canvas or export names a particular symbol. So **adding a symbol is
 * adding one entry to `SYMBOLS`** (and its shape to `shapes.ts` when no existing
 * one fits); the file format, the line grammar, does not change.
 *
 * A `^word` that is not in the registry is not a mark of this build: it stays
 * part of the title, so a note written with a newer mark still opens, and the
 * mark shows as text.
 */
import type { Locale } from "../../i18n";

export interface AlgorithmSymbol {
  /** Stable machine name; what the model calls the kind. */
  kind: string;
  /** The `^mark` written on the node's line. `^process` is also accepted for a plain process. */
  mark: string;
  /** Id of the shape in the shape registry (`shapes.ts`). */
  shape: string;
  /** What the editor calls the symbol, per language. */
  label: Record<Locale, string>;
}

export const SYMBOLS = [
  { kind: "start", mark: "^start", shape: "pill", label: { en: "Start", ja: "開始" } },
  { kind: "end", mark: "^end", shape: "pill", label: { en: "End", ja: "終了" } },
  { kind: "process", mark: "^process", shape: "rect", label: { en: "Process", ja: "処理" } },
  { kind: "decision", mark: "^decision", shape: "diamond", label: { en: "Decision", ja: "判断" } },
  {
    kind: "io",
    mark: "^io",
    shape: "parallelogram",
    label: { en: "Input/output", ja: "入出力" },
  },
  {
    kind: "sub",
    mark: "^sub",
    shape: "subroutine",
    label: { en: "Predefined process", ja: "定義済み処理" },
  },
  { kind: "doc", mark: "^doc", shape: "document", label: { en: "Document", ja: "書類" } },
] as const satisfies readonly AlgorithmSymbol[];

export type NodeKind = (typeof SYMBOLS)[number]["kind"];
export const NODE_KINDS = SYMBOLS.map((s) => s.kind) as readonly NodeKind[];

/** The kind a node gets when nothing says otherwise. It is written without a mark. */
export const DEFAULT_KIND: NodeKind = "process";

const BY_KIND = new Map<string, AlgorithmSymbol>(SYMBOLS.map((s) => [s.kind, s]));
const BY_MARK = new Map<string, AlgorithmSymbol>(SYMBOLS.map((s) => [s.mark, s]));

export function symbolOfKind(kind: string): AlgorithmSymbol {
  return BY_KIND.get(kind) ?? BY_KIND.get(DEFAULT_KIND)!;
}

/** The symbol a `^mark` token names, or `undefined` when it is not a mark of this build. */
export function symbolOfMark(token: string): AlgorithmSymbol | undefined {
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
