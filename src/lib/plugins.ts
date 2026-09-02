/**
 * Plugins tab: what the facts collected by `src-tauri/src/plugins.rs` mean.
 *
 * The backend deliberately only reads files. Everything judgemental — is this
 * row a problem, which scope would an action target, is the installed version
 * behind the marketplace — lives here as pure functions so it can be tested
 * without a vault, a marketplace clone or a Claude Code install.
 */

import type { PluginRow, PluginScope, PluginsState } from "@/types";

/**
 * What a row is telling the owner. Ordered by how much it wants attention:
 * `missing` is a broken harness, `off` is a deliberate choice.
 */
export type PluginStatus =
  | "missing" // required by the catalog, but not switched on anywhere
  | "pending" // switched on, not installed yet — Claude Code installs it next launch
  | "outdated" // installed version is behind the marketplace clone
  | "ok" // on, installed, current
  | "unknown" // on and installed, but the clone offers no version to compare
  | "off"; // optional and switched off — nothing to do

export interface PluginView extends PluginRow {
  status: PluginStatus;
  enabled: boolean;
  /** Scope the row is actually enabled at, or the catalog default when off. */
  effective_scope: Exclude<PluginScope, "either">;
  /** Version of the install that matches `effective_scope`; "" when none. */
  installed_version: string;
  /** True when the plugin is enabled but the catalog does not list it. */
  extra: boolean;
}

/**
 * Compare dotted numeric versions ("0.25.1"). Returns <0 when `a` is older.
 * Missing components count as 0, and any non-numeric tail is ignored, so
 * "1.2" < "1.2.1" and "1.2.0-beta" compares as "1.2.0" — good enough to answer
 * "is there something newer", which is all the tab asks.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The scope an action on this row targets.
 *
 * A `project`/`user` plugin has only one right answer. An `either` plugin is
 * installable at both, so the scope follows where it is actually switched on;
 * with it off everywhere, `user` is the default — that is where a personal
 * tool belongs, and it is the scope `claude plugin install` itself defaults to.
 */
export function effectiveScope(row: PluginRow): Exclude<PluginScope, "either"> {
  if (row.scope === "project" || row.scope === "user") return row.scope;
  if (row.enabled_project) return "project";
  if (row.enabled_user) return "user";
  // An uncatalogued row has no declared scope either; fall back the same way.
  const installed = row.installs.find((i) => i.scope === "project" || i.scope === "user");
  return installed?.scope === "project" ? "project" : "user";
}

/** Version installed at the scope the row is used from; "" when not installed. */
export function installedVersion(row: PluginRow, scope: string): string {
  const exact = row.installs.find((i) => i.scope === scope);
  // Fall back to any install: a plugin installed at another scope is still on
  // disk, and reporting "not installed" for it would be a lie.
  return (exact ?? row.installs[0])?.version ?? "";
}

/** Decide a row's status. See `PluginStatus` for what each one means. */
export function pluginStatus(row: PluginRow): PluginStatus {
  const enabled = row.enabled_project || row.enabled_user;
  if (!enabled) return row.required ? "missing" : "off";
  const installed = installedVersion(row, effectiveScope(row));
  if (!installed) return "pending";
  if (!row.latest_version) return "unknown";
  return compareVersions(installed, row.latest_version) < 0 ? "outdated" : "ok";
}

const STATUS_ORDER: Record<PluginStatus, number> = {
  missing: 0,
  outdated: 1,
  pending: 2,
  unknown: 3,
  ok: 4,
  off: 5,
};

/**
 * Rows in the order the tab shows them: whatever needs a decision first, then
 * the catalog's own order (which is the order `docs/plugins.md` explains them
 * in), with uncatalogued leftovers last.
 */
export function pluginViews(state: PluginsState): PluginView[] {
  const ordered = state.rows.map((row, index) => {
    const scope = effectiveScope(row);
    const view: PluginView = {
      ...row,
      status: pluginStatus(row),
      enabled: row.enabled_project || row.enabled_user,
      effective_scope: scope,
      installed_version: installedVersion(row, scope),
      extra: !row.in_catalog,
    };
    return { view, index };
  });
  ordered.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.view.status] - STATUS_ORDER[b.view.status];
    if (byStatus !== 0) return byStatus;
    if (a.view.extra !== b.view.extra) return a.view.extra ? 1 : -1;
    return a.index - b.index;
  });
  return ordered.map((o) => o.view);
}

/** Rows the owner should act on, in the same order the list shows them. */
export function pluginProblems(views: PluginView[]): PluginView[] {
  return views.filter((v) => v.status === "missing" || v.status === "outdated");
}
