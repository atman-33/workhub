/**
 * The symbols of a PFD (process flow diagram), as a registry (T-0683).
 *
 * A node's kind is decided by the prefix of its id: `P-001` is a process,
 * `D-001` a deliverable. The registry is the whole definition of a symbol - its
 * prefix, a name, the shape it is drawn with and the prefix an arrow usually
 * runs on to - and nothing else in the parser, layout, canvas or export names a
 * particular symbol. So **adding a symbol is adding one entry to `SYMBOLS`**
 * (and its shape to `shapes.ts` when no existing one fits); the file format,
 * the line grammar, does not change.
 *
 * A line whose prefix is not in the registry is not a node of this build: the
 * parser keeps it as a raw line and the editor counts it as a warning, so a
 * note that uses a symbol not confirmed yet survives untouched.
 */
import type { Locale } from "../../i18n";

export interface PfdSymbol {
  /** The id prefix: letters, no hyphen (`P` for `P-001`). */
  prefix: string;
  /** Stable machine name, for tests and for the AI-facing rule. */
  name: string;
  /** Id of the shape in the shape registry (`shapes.ts`). */
  shape: string;
  /** What the editor calls the symbol, per language. */
  label: Record<Locale, string>;
  /**
   * Prefixes an arrow from this symbol usually goes to; the first is what "add
   * after this node" creates. A hint only: an arrow may join any two nodes.
   */
  next: string[];
}

export const SYMBOLS: PfdSymbol[] = [
  {
    prefix: "P",
    name: "process",
    shape: "ellipse",
    label: { en: "Process", ja: "プロセス" },
    next: ["D"],
  },
  {
    prefix: "D",
    name: "deliverable",
    shape: "document",
    label: { en: "Deliverable", ja: "成果物" },
    next: ["P"],
  },
];

/** The symbol a new node gets when nothing says otherwise (and to an id-less line). */
export const DEFAULT_PREFIX = SYMBOLS[0].prefix;

const ID_RE = /^([A-Z]{1,3})-(\d+)$/;

/** The prefix of an id (`P` of `P-001`), or `""` when it is not an id. */
export function prefixOf(id: string): string {
  return ID_RE.exec(id)?.[1] ?? "";
}

export function symbolByPrefix(prefix: string): PfdSymbol | undefined {
  return SYMBOLS.find((s) => s.prefix === prefix);
}

/** The symbol of a node id, or `undefined` for an id this build does not know. */
export function symbolOf(id: string): PfdSymbol | undefined {
  return symbolByPrefix(prefixOf(id));
}

/** True when `id` is an id of a registered symbol. */
export function isNodeId(id: string): boolean {
  return symbolOf(id) !== undefined;
}

/** True when an arrow may run from `from` to `to`: two different nodes of this
 * build, of any kinds (P->P and D->D are drawn like P->D). */
export function mayConnect(from: string, to: string): boolean {
  return from !== to && isNodeId(from) && isNodeId(to);
}

/** The first symbol an arrow from `id` may reach: what "add after this node" adds. */
export function followingSymbol(id: string): PfdSymbol | undefined {
  const next = symbolOf(id)?.next[0];
  return next ? symbolByPrefix(next) : undefined;
}
