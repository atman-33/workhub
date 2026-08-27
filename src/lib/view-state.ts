/**
 * Per-tab UI state that has to survive an app restart: which note the Mindmap
 * and Schedule tabs had open, and which project their picker was narrowed to.
 *
 * This lives in `localStorage` rather than in the vault config on purpose. It
 * is machine-local UI state, not vault data — syncing "the note I had open on
 * this laptop" to another machine would be wrong, and writing it into the
 * config would churn a file agents and Obsidian also read.
 */

export interface ViewState {
  /** Project slug the picker was narrowed to; "" means all projects. */
  project: string;
  /** Vault-relative path of the note that was open; "" means none. */
  path: string;
}

const EMPTY: ViewState = { project: "", path: "" };

function key(id: string, field: keyof ViewState): string {
  return `${id}.last${field === "project" ? "Project" : "Path"}`;
}

/** Reads a view's remembered state. Anything missing or unreadable reads as "". */
export function readViewState(id: string): ViewState {
  try {
    return {
      project: localStorage.getItem(key(id, "project")) ?? "",
      path: localStorage.getItem(key(id, "path")) ?? "",
    };
  } catch {
    // storage unavailable (private mode / quota) — restoring is a convenience
    return EMPTY;
  }
}

/** Persists one field of a view's state. */
export function writeViewState(id: string, field: keyof ViewState, value: string): void {
  try {
    localStorage.setItem(key(id, field), value);
  } catch {
    // storage unavailable (private mode / quota) — restoring is a convenience
  }
}
