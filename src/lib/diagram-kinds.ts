import { CalendarRange, Grid2x2, Network, Waypoints, Workflow } from "lucide-react";
import type { ComponentType } from "react";
import type { MessageKey } from "@/lib/i18n";

/**
 * The kinds of diagram the Diagrams tab lists (T-0680). The value is the
 * note's frontmatter `type`.
 */
export const DIAGRAM_KINDS = ["schedule", "mindmap", "matrix2x2", "flow", "pfd"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

/**
 * The kinds the New dialog offers. A kind joins this list when its editor
 * lands (2x2 in T-0681, business flow in T-0682, PFD in T-0683); until then a
 * note of that kind can still be listed, but nobody is invited to make one
 * that has no editor.
 */
export const CREATABLE_KINDS: readonly DiagramKind[] = ["schedule", "mindmap"];

export const KIND_LABEL_KEY: Record<DiagramKind, MessageKey> = {
  schedule: "diagram.kind.schedule",
  mindmap: "diagram.kind.mindmap",
  matrix2x2: "diagram.kind.matrix2x2",
  flow: "diagram.kind.flow",
  pfd: "diagram.kind.pfd",
};

export const KIND_ICON: Record<DiagramKind, ComponentType<{ className?: string }>> = {
  schedule: CalendarRange,
  mindmap: Network,
  matrix2x2: Grid2x2,
  flow: Workflow,
  pfd: Waypoints,
};

export function isDiagramKind(value: string): value is DiagramKind {
  return (DIAGRAM_KINDS as readonly string[]).includes(value);
}

/** `B-NNN` of a `backlog:B-NNN` scope, or `""` for a project-wide note. */
export function backlogOfScope(scope: string): string {
  return scope.startsWith("backlog:") ? scope.slice("backlog:".length) : "";
}
