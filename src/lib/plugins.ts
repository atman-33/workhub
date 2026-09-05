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
  | "advised" // recommended by the catalog and switched off — a suggestion, not a fault
  | "ok" // on, installed, current
  | "unknown" // on and installed, but the clone offers no version to compare
  | "off"; // optional and switched off — nothing to do

export interface PluginView extends PluginRow {
  status: PluginStatus;
  /** True when this row's marketplace ships a catalog — workhub's own. */
  catalogued: boolean;
  enabled: boolean;
  /** Scope the row is actually enabled at, or the catalog default when off. */
  effective_scope: Exclude<PluginScope, "either">;
  /** Version of the install that matches `effective_scope`; "" when none. */
  installed_version: string;
  /**
   * True when the plugin is enabled but its marketplace's catalog does not
   * list it. Only ever true for a catalogued marketplace: elsewhere there is
   * no catalog to be absent from, so "not in catalog" would be a complaint
   * about a file that was never supposed to exist.
   */
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
  // A row from an uncatalogued marketplace has no declared scope at all, so it
  // falls through to where it is actually enabled or installed, below.
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

/**
 * Decide a row's status. See `PluginStatus` for what each one means.
 *
 * `catalogued` says whether this row's marketplace ships a `catalog.json`.
 * Without one there is no tier, so nothing can be called `missing` or
 * `advised` — those two are claims about what the vault needs, and only
 * workhub's own marketplace is in a position to make them (T-0238). An
 * off plugin from anywhere else is simply off, which is not a problem.
 */
export function pluginStatus(row: PluginRow, catalogued = true): PluginStatus {
  const enabled = row.enabled_project || row.enabled_user;
  if (!enabled) {
    if (!catalogued) return "off";
    if (row.tier === "required") return "missing";
    return row.tier === "recommended" ? "advised" : "off";
  }
  const installed = installedVersion(row, effectiveScope(row));
  if (!installed) return "pending";
  if (!row.latest_version) return "unknown";
  return compareVersions(installed, row.latest_version) < 0 ? "outdated" : "ok";
}

const STATUS_ORDER: Record<PluginStatus, number> = {
  missing: 0,
  outdated: 1,
  advised: 2,
  pending: 3,
  unknown: 4,
  ok: 5,
  off: 6,
};

/**
 * How much the catalog says the harness wants a plugin. An uncatalogued row
 * has no tier and sorts after every catalogued one.
 */
const TIER_ORDER: Record<string, number> = {
  required: 0,
  recommended: 1,
  optional: 2,
};

/**
 * Rows in the order the tab shows them: whatever needs a decision first, then
 * by tier, then the catalog's own order (which is the order `docs/plugins.md`
 * explains them in), with uncatalogued leftovers last.
 *
 * Tier is a tie-break rather than the first key because a broken harness beats
 * a classification — an `optional` plugin that is enabled but outdated still
 * wants attention before a `required` one that is already fine. Where it earns
 * its keep is the ordinary case, in which every row is `ok` and the status key
 * decides nothing: the list then fell straight through to the catalog's order,
 * which put a recommended plugin below the optional ones purely by where it
 * happened to be written down.
 */
export function pluginViews(state: PluginsState): PluginView[] {
  const catalogued = new Set(
    state.marketplaces.filter((m) => m.catalog_found).map((m) => m.name),
  );
  const ordered = state.rows.map((row, index) => {
    const scope = effectiveScope(row);
    const inCatalogued = catalogued.has(row.marketplace);
    const view: PluginView = {
      ...row,
      status: pluginStatus(row, inCatalogued),
      catalogued: inCatalogued,
      enabled: row.enabled_project || row.enabled_user,
      effective_scope: scope,
      installed_version: installedVersion(row, scope),
      extra: inCatalogued && !row.in_catalog,
    };
    return { view, index };
  });
  ordered.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.view.status] - STATUS_ORDER[b.view.status];
    if (byStatus !== 0) return byStatus;
    if (a.view.extra !== b.view.extra) return a.view.extra ? 1 : -1;
    const byTier =
      (TIER_ORDER[a.view.tier] ?? Number.MAX_SAFE_INTEGER) -
      (TIER_ORDER[b.view.tier] ?? Number.MAX_SAFE_INTEGER);
    if (byTier !== 0) return byTier;
    return a.index - b.index;
  });
  return ordered.map((o) => o.view);
}

/** The rows belonging to one marketplace, in the order the list shows them. */
export function pluginsOfMarketplace(views: PluginView[], marketplace: string): PluginView[] {
  return views.filter((v) => v.marketplace === marketplace);
}

/**
 * Rows the owner should act on, in the same order the list shows them.
 *
 * `advised` is deliberately not here: a recommended plugin left off is a
 * choice, and putting it in the same list as a broken harness would train the
 * owner to ignore the list.
 *
 * Only ever `missing` or `outdated`, and `missing` can only arise on a
 * catalogued marketplace — see `pluginStatus`.
 */
export function pluginProblems(views: PluginView[]): PluginView[] {
  return views.filter((v) => v.status === "missing" || v.status === "outdated");
}

/** Recommended plugins that are switched off — a suggestion, shown apart. */
export function pluginSuggestions(views: PluginView[]): PluginView[] {
  return views.filter((v) => v.status === "advised");
}
