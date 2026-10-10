import { CalendarRange, GitBranch, Grid2x2, Network, Waypoints, Workflow } from "lucide-react";
import type { ComponentType } from "react";
import type { MessageKey } from "@/lib/i18n";

/**
 * The kinds of diagram the Diagrams tab lists, in the one order every part of
 * the tab uses: the filter chips, the grouped list and the New dialog (T-0701).
 * A kind is the note's frontmatter `type`.
 *
 * Kinds are grouped by purpose, coarse to fine inside a group. The order is
 * fixed on purpose (not by how often a kind is used) so a chip stays where the
 * owner's eye expects it. To add a kind: put it in its group here, give it a
 * label and an icon below (the types force both), and add it to `KINDS` in
 * `src-tauri/src/diagram.rs`. The `system` group is ready for the use-case,
 * architecture and IFDAM diagrams; it is empty until they exist, and an empty
 * group draws nothing.
 */
export const KIND_GROUPS = [
  { id: "plan", labelKey: "diagram.group.plan", kinds: ["schedule", "mindmap", "matrix2x2"] },
  { id: "process", labelKey: "diagram.group.process", kinds: ["pfd", "flow", "algorithm"] },
  { id: "system", labelKey: "diagram.group.system", kinds: [] },
] as const satisfies readonly { id: string; labelKey: MessageKey; kinds: readonly string[] }[];

export type DiagramKind = (typeof KIND_GROUPS)[number]["kinds"][number];

/** Every kind, in display order (groups flattened). */
export const DIAGRAM_KINDS: readonly DiagramKind[] = KIND_GROUPS.flatMap(
  (g) => g.kinds as readonly DiagramKind[],
);

/**
 * The kinds the New dialog offers. A kind joins this list when its editor
 * lands (2x2 in T-0681, business flow in T-0682, PFD in T-0683, program flow
 * in T-0699); until then a note of that kind can still be listed, but nobody
 * is invited to make one that has no editor. Listed in display order.
 */
export const CREATABLE_KINDS: readonly DiagramKind[] = DIAGRAM_KINDS.filter((k) =>
  ["schedule", "mindmap", "matrix2x2", "flow", "pfd", "algorithm"].includes(k),
);

/** The kinds that have an editor, and so can be renamed and deleted from the list. */
export function hasEditor(kind: string): boolean {
  return (CREATABLE_KINDS as readonly string[]).includes(kind);
}

export const KIND_LABEL_KEY: Record<DiagramKind, MessageKey> = {
  schedule: "diagram.kind.schedule",
  mindmap: "diagram.kind.mindmap",
  matrix2x2: "diagram.kind.matrix2x2",
  flow: "diagram.kind.flow",
  pfd: "diagram.kind.pfd",
  algorithm: "diagram.kind.algorithm",
};

export const KIND_ICON: Record<DiagramKind, ComponentType<{ className?: string }>> = {
  schedule: CalendarRange,
  mindmap: Network,
  matrix2x2: Grid2x2,
  flow: Workflow,
  pfd: Waypoints,
  algorithm: GitBranch,
};

export function isDiagramKind(value: string): value is DiagramKind {
  return (DIAGRAM_KINDS as readonly string[]).includes(value);
}

/** `B-NNN` of a `backlog:B-NNN` scope, or `""` for a project-wide note. */
export function backlogOfScope(scope: string): string {
  return scope.startsWith("backlog:") ? scope.slice("backlog:".length) : "";
}
