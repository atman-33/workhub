/**
 * Pure logic of the Diagrams tab's chips and note list (T-0701): which kind
 * chips show, how the list is grouped and ordered, and which groups the owner
 * collapsed. Kind order and groups come from `diagram-kinds.ts`; nothing here
 * knows a kind by name.
 */
import { DIAGRAM_KINDS, KIND_GROUPS, isDiagramKind, type DiagramKind } from "@/lib/diagram-kinds";
import type { MessageKey } from "@/lib/i18n";
import type { DiagramFile } from "@/types";

export type ListSort = "updated" | "name";

/** The kind filter value that means "every kind". */
export const ALL_KINDS = "__all__";

export interface KindChip {
  kind: DiagramKind;
  count: number;
}

export interface ChipGroup {
  id: string;
  labelKey: MessageKey;
  chips: KindChip[];
}

/**
 * The kind chips, grouped, in display order. A kind with no files is left out
 * unless it is the selected one (a chip the owner is standing on must not
 * vanish). A group with no chip is left out, so no separator is drawn for it.
 */
export function chipGroups(files: readonly DiagramFile[], selected: string): ChipGroup[] {
  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  return KIND_GROUPS.map((g) => ({
    id: g.id,
    labelKey: g.labelKey,
    chips: (g.kinds as readonly DiagramKind[])
      .map((kind) => ({ kind, count: counts.get(kind) ?? 0 }))
      .filter((c) => c.count > 0 || c.kind === selected),
  })).filter((g) => g.chips.length > 0);
}

/** Notes of a list, ordered. Newest `updated` first by default, ties by name. */
export function sortFiles(files: readonly DiagramFile[], sort: ListSort): DiagramFile[] {
  const byName = (a: DiagramFile, b: DiagramFile) =>
    a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
  return [...files].sort((a, b) => {
    if (sort === "updated" && a.updated !== b.updated) {
      // An empty `updated` is the oldest. ISO dates compare as strings.
      return a.updated < b.updated ? 1 : -1;
    }
    return byName(a, b);
  });
}

export interface KindSection {
  kind: DiagramKind;
  files: DiagramFile[];
}

/**
 * The list under `All`: one section per kind that has notes, in the display
 * order of the chips, each ordered by `sort`. Notes of a kind this build does
 * not know are not listed.
 */
export function sectionsOf(files: readonly DiagramFile[], sort: ListSort): KindSection[] {
  return DIAGRAM_KINDS.map((kind) => ({
    kind,
    files: sortFiles(
      files.filter((f) => f.kind === kind),
      sort,
    ),
  })).filter((s) => s.files.length > 0);
}

/** The notes in the order the list shows them, for the given kind filter. */
export function listedFiles(
  files: readonly DiagramFile[],
  kindFilter: string,
  sort: ListSort,
): DiagramFile[] {
  if (kindFilter === ALL_KINDS) return sectionsOf(files, sort).flatMap((s) => s.files);
  return sortFiles(
    files.filter((f) => f.kind === kindFilter && isDiagramKind(f.kind)),
    sort,
  );
}

export function isCollapsed(collapsed: readonly string[], kind: string): boolean {
  return collapsed.includes(kind);
}

/** The collapsed list with one kind collapsed or expanded; the input is not changed. */
export function withCollapsed(collapsed: readonly string[], kind: string, value: boolean): string[] {
  const rest = collapsed.filter((k) => k !== kind);
  return value ? [...rest, kind] : rest;
}

/** The date part of a note's `updated`, or `""`. */
export function updatedDay(updated: string): string {
  return updated.slice(0, 10);
}
