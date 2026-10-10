import { useSyncExternalStore } from "react";
import { formatId } from "./note";
import type { DiagramKind } from "../diagram-kinds";

/**
 * The in-app clipboard every diagram kind shares (T-0688).
 *
 * Deliberately **not** the OS clipboard: what is copied is a structured
 * snapshot of nodes, not text, and nothing outside the app can paste it. It
 * lives in memory for the session. A snapshot is tied to the note it was
 * copied from, so it can be pasted only into the same kind and the same file -
 * the ids it carries mean nothing in another note.
 *
 * What a snapshot holds, and where a paste lands, is the kind's own business
 * (`<kind>/clipboard.ts`); this file only holds the snapshot, allocates fresh
 * ids and filters arrows.
 */

export interface DiagramClip<P> {
  kind: DiagramKind;
  /** Absolute path of the note the snapshot was taken from. */
  path: string;
  payload: P;
  /** How many times it has been pasted, so a repeated paste fans out. */
  pastes: number;
}

let current: DiagramClip<unknown> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function clipboardSubscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replaces the clipboard with a fresh snapshot. */
export function setClip<P>(kind: DiagramKind, path: string, payload: P): void {
  current = { kind, path, payload, pastes: 0 };
  emit();
}

/** The snapshot, only when it was copied from this kind of note in this very file. */
export function readClip<P>(kind: DiagramKind, path: string): DiagramClip<P> | null {
  if (!current || current.kind !== kind || current.path !== path) return null;
  return current as DiagramClip<P>;
}

export function hasClip(kind: DiagramKind, path: string): boolean {
  return readClip(kind, path) !== null;
}

/**
 * Counts one paste and returns its round (1 for the first). The round is how
 * far the copy is moved from the original, so pasting twice does not stack two
 * copies on the same spot.
 */
export function takePasteRound(kind: DiagramKind, path: string): number {
  const clip = readClip(kind, path);
  if (!clip) return 0;
  clip.pastes += 1;
  return clip.pastes;
}

/** Whether a paste into this note would do anything, for the menu and the shortcut. */
export function useHasClip(kind: DiagramKind, path: string): boolean {
  return useSyncExternalStore(clipboardSubscribe, () => hasClip(kind, path));
}

/** Empties the clipboard (tests). */
export function resetClipboard(): void {
  current = null;
  emit();
}

const ID_RE = /^([A-Z]{1,3})-(\d+)$/;

/**
 * Fresh ids for copies: each source id gets the next free number of its own
 * prefix, above everything in `existing`, so an id is never reused - not even
 * the number of an element that was deleted from the middle. Several sources
 * of one prefix are numbered in the order given.
 */
export function allocateIds(
  existing: Iterable<string>,
  sources: readonly string[],
): Map<string, string> {
  const max = new Map<string, number>();
  for (const id of existing) {
    const m = ID_RE.exec(id);
    if (m) max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
  }
  const out = new Map<string, string>();
  for (const id of sources) {
    const m = ID_RE.exec(id);
    if (!m) throw new Error(`not an element id: ${id}`);
    const n = (max.get(m[1]) ?? 0) + 1;
    max.set(m[1], n);
    out.set(id, formatId(m[1], n));
  }
  return out;
}

/** The arrows with both ends in `ids`: the only ones a copy takes along. */
export function edgesWithin<E extends { from: string; to: string }>(
  edges: readonly E[],
  ids: ReadonlySet<string>,
): E[] {
  return edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ ...e }));
}

/** The arrows with both ends rewritten through `idMap`. */
export function remapEdges<E extends { from: string; to: string }>(
  edges: readonly E[],
  idMap: ReadonlyMap<string, string>,
): E[] {
  return edges.map((e) => ({
    ...e,
    from: idMap.get(e.from) ?? e.from,
    to: idMap.get(e.to) ?? e.to,
  }));
}

/**
 * Which clipboard gesture a key press is, if any. Ctrl (or Cmd) with C or V,
 * nothing else held. A copy is left alone while text is selected on the page,
 * so the browser's own copy of a selection keeps working; typing fields are the
 * caller's check (it already skips them for every other shortcut).
 */
export function clipboardShortcut(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): "copy" | "paste" | null {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "v") return "paste";
  if (key === "c") {
    const selection = typeof window === "undefined" ? null : window.getSelection();
    return selection && !selection.isCollapsed ? null : "copy";
  }
  return null;
}
