// The contract between the board (main window) and the task editor window.
//
// The editor lives in its own native window (src-tauri/src/task_editor.rs) so
// it can be parked on a second screen. That makes every hand-off between the
// two an event rather than a prop, and this module is where those events and
// their payloads are named — so adding a field means editing one file, not
// hunting through both windows.

import type { Task } from "@/types";

/** Rust → editor window: initialize the form. Sent on every open, which is
 *  also how clicking a second card while the editor is open switches it. */
export const TASK_EDITOR_OPEN_EVENT = "task-editor://open";

/** Editor window → board: open the embedded terminal panel, because an agent
 *  launch is about to start and the panel is what it runs in. The editor
 *  cannot do this itself — the panel is part of the main window's layout. */
export const TASK_EDITOR_TERMINAL_PANEL_EVENT = "task-editor://open-terminal-panel";

/** Everything the editor needs that it cannot read for itself. Settings are
 *  deliberately absent: the editor loads its own `Config`, so there is one
 *  source of truth for them. `knownProjects` is the exception — it is derived
 *  from the board's already-loaded task list, and re-reading every task just
 *  to rebuild it would make opening the editor cost a vault scan. */
export interface TaskEditorPayload {
  mode: "create" | "edit";
  /** The task being edited; null in create mode. */
  task: Task | null;
  /** Suggestions for the Project field. */
  knownProjects: string[];
}
