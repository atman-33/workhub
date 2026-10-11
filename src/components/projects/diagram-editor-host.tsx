import { useState, type ComponentType } from "react";
import { FlowView } from "@/components/diagram/flow/flow-view";
import { PfdView } from "@/components/diagram/pfd/pfd-view";
import { AlgorithmView } from "@/components/diagram/algorithm/algorithm-view";
import { ArchitectureView } from "@/components/diagram/architecture/architecture-view";
import { IfdamView } from "@/components/diagram/ifdam/ifdam-view";
import { UsecaseView } from "@/components/diagram/usecase/usecase-view";
import { MatrixView } from "@/components/diagram/matrix2x2/matrix-view";
import { MindmapView } from "@/components/mindmap/mindmap-view";
import { ScheduleView } from "@/components/schedule/schedule-view";
import type { EmbeddedDiagram } from "@/lib/embedded-diagram";
import type { DiagramKind } from "@/lib/diagram-kinds";

/** What every editor view accepts from a host: the Diagrams tab's contract. */
type EditorComponent = ComponentType<{
  configVersion: number;
  embedded: EmbeddedDiagram;
}>;

/**
 * The one editor for a diagram kind (T-0738). Pure, so the kind coverage —
 * all nine kinds map, anything else maps to nothing — is pinned by a test
 * rather than by looking at the pane. Every entry takes the same
 * `{ configVersion, embedded }`, so the host below can render whichever one
 * this returns without per-kind branches.
 */
export function editorComponentFor(kind: string): EditorComponent | null {
  switch (kind) {
    case "schedule":
      return ScheduleView;
    case "mindmap":
      return MindmapView;
    case "matrix2x2":
      return MatrixView;
    case "flow":
      return FlowView;
    case "pfd":
      return PfdView;
    case "algorithm":
      return AlgorithmView;
    case "usecase":
      return UsecaseView;
    case "architecture":
      return ArchitectureView;
    case "ifdam":
      return IfdamView;
    default:
      return null;
  }
}

interface Props {
  /** The note's frontmatter `type`; always a known kind where this is used. */
  kind: DiagramKind;
  /** Absolute path of the note to edit. */
  path: string;
  /** The note's title (frontmatter title, or the file name). */
  title: string;
  /** Slug of the project the note belongs to. */
  project: string;
  /** Bumped by the app shell after settings are saved. */
  configVersion: number;
  /** The note vanished (or the reader backed out): clear the selection. */
  onClose: () => void;
}

/**
 * Hosts one diagram editor view inside the Projects tab's Backlog and
 * Documents panes (T-0738): the same real editor the Diagrams tab embeds
 * (T-0680), with the same `{ configVersion, embedded }` props.
 *
 * Only the view matching `kind` is mounted — never all nine. The view owns
 * its debounced save; the host adds nothing to it. `locked` stays false
 * (there is no AI runner on this side, so nothing takes the lock),
 * `reloadToken` stays 0 (external edits arrive through the file watcher the
 * views already listen to), and the side panel starts open, like a freshly
 * opened note. `onPathChange("")` means the note is gone — a delete or a move
 * elsewhere — so the pane lets go of it.
 *
 * The parent gives this its height (`min-h-0 flex-1`); the view fills it with
 * `h-full`, so no page-level scroll appears.
 */
export function DiagramEditorHost({ kind, path, title, project, configVersion, onClose }: Props) {
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const View = editorComponentFor(kind);
  if (!View) return null;
  const embedded: EmbeddedDiagram = {
    project,
    path,
    title,
    onPathChange: (next: string) => {
      if (!next) onClose();
    },
    locked: false,
    registerFlush: () => {},
    reloadToken: 0,
    sidePanelOpen,
    onSidePanelOpenChange: setSidePanelOpen,
  };
  return (
    <div className="min-h-0 flex-1">
      <View configVersion={configVersion} embedded={embedded} />
    </div>
  );
}
