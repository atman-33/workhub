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

/** The vault path the views last ran against, or `""` on first run. */
const LAST_VAULT_KEY = "vault.lastVaultPath";

/**
 * Reads the vault path stored by the last session. The Schedule and Mindmap
 * tabs restore their open note from `ViewState`, which holds an absolute path
 * — after a vault switch that path points into the vault just left behind,
 * and a same-named project there makes it look alive (T-0344). Comparing
 * against this is what tells a same-vault restart ("restore") apart from a
 * switch ("drop the old note").
 */
export function readLastVaultPath(): string {
  try {
    return localStorage.getItem(LAST_VAULT_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Persists the vault path the views are running against. */
export function writeLastVaultPath(vaultPath: string): void {
  try {
    localStorage.setItem(LAST_VAULT_KEY, vaultPath);
  } catch {
    // storage unavailable (private mode / quota) — restoring is a convenience
  }
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
