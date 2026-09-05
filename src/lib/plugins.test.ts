import { describe, expect, it } from "vitest";
import {
  compareVersions,
  effectiveScope,
  installedVersion,
  pluginProblems,
  pluginStatus,
  pluginsOfMarketplace,
  pluginSuggestions,
  pluginViews,
} from "@/lib/plugins";
import type { MarketplaceInfo, PluginRow, PluginsState } from "@/types";

function row(over: Partial<PluginRow> = {}): PluginRow {
  return {
    name: "workhub",
    marketplace: "workhub-marketplace",
    in_catalog: true,
    tier: "optional",
    scope: "project",
    summary: "",
    latest_version: "1.0.0",
    installs: [],
    enabled_project: false,
    enabled_user: false,
    ...over,
  };
}

function marketplace(over: Partial<MarketplaceInfo> = {}): MarketplaceInfo {
  return {
    name: "workhub-marketplace",
    clone_path: "C:/clone",
    clone_found: true,
    catalog_found: true,
    marketplace_updated: "",
    ...over,
  };
}

function state(rows: PluginRow[], marketplaces = [marketplace()]): PluginsState {
  return {
    marketplace: "workhub-marketplace",
    marketplaces,
    project_settings_path: "C:/vault/.claude/settings.json",
    user_settings_path: "C:/home/.claude/settings.json",
    rows,
  };
}

describe("compareVersions", () => {
  it("orders dotted numeric versions", () => {
    expect(compareVersions("0.24.0", "0.25.1")).toBe(-1);
    expect(compareVersions("0.25.1", "0.25.1")).toBe(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("treats a missing component as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBe(-1);
  });

  it("ignores a non-numeric tail rather than failing", () => {
    expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(0);
    expect(compareVersions("", "0.1.0")).toBe(-1);
  });
});

describe("effectiveScope", () => {
  it("follows the catalog when it declares one", () => {
    expect(effectiveScope(row({ scope: "project" }))).toBe("project");
    expect(effectiveScope(row({ scope: "user" }))).toBe("user");
  });

  it("follows where an `either` plugin is actually enabled", () => {
    expect(effectiveScope(row({ scope: "either", enabled_project: true }))).toBe("project");
    expect(effectiveScope(row({ scope: "either", enabled_user: true }))).toBe("user");
  });

  it("falls back to the install, then to user, for an `either` plugin that is off", () => {
    const installed = row({
      scope: "either",
      installs: [{ scope: "project", version: "1.0.0", project_path: "C:/vault", install_path: ""  }],
    });
    expect(effectiveScope(installed)).toBe("project");
    expect(effectiveScope(row({ scope: "either" }))).toBe("user");
  });

  it("falls back the same way for an uncatalogued row", () => {
    expect(effectiveScope(row({ in_catalog: false, scope: "" }))).toBe("user");
  });
});

describe("installedVersion", () => {
  it("prefers the install at the asked-for scope", () => {
    const r = row({
      installs: [
        { scope: "user", version: "1.0.0", project_path: "", install_path: ""  },
        { scope: "project", version: "2.0.0", project_path: "C:/vault", install_path: ""  },
      ],
    });
    expect(installedVersion(r, "project")).toBe("2.0.0");
    expect(installedVersion(r, "user")).toBe("1.0.0");
  });

  it("reports an install at another scope rather than claiming nothing", () => {
    const r = row({ installs: [{ scope: "user", version: "1.0.0", project_path: "", install_path: ""  }] });
    expect(installedVersion(r, "project")).toBe("1.0.0");
  });

  it("is empty when the plugin is not installed at all", () => {
    expect(installedVersion(row(), "user")).toBe("");
  });
});

describe("pluginStatus", () => {
  const install = (version: string) => [{ scope: "project", version, project_path: "C:/v", install_path: ""  }];

  it("flags a required plugin that is switched off", () => {
    expect(pluginStatus(row({ tier: "required" }))).toBe("missing");
  });

  it("suggests, rather than flags, a recommended plugin that is switched off", () => {
    expect(pluginStatus(row({ tier: "recommended" }))).toBe("advised");
  });

  it("leaves an optional plugin that is switched off alone", () => {
    expect(pluginStatus(row({ tier: "optional" }))).toBe("off");
  });

  it("treats an uncatalogued row as optional", () => {
    expect(pluginStatus(row({ in_catalog: false, tier: "" }))).toBe("off");
  });

  it("calls an enabled-but-uninstalled plugin pending", () => {
    expect(pluginStatus(row({ enabled_project: true }))).toBe("pending");
  });

  it("compares the installed version against the marketplace", () => {
    const base = { enabled_project: true, latest_version: "0.25.1" };
    expect(pluginStatus(row({ ...base, installs: install("0.24.0") }))).toBe("outdated");
    expect(pluginStatus(row({ ...base, installs: install("0.25.1") }))).toBe("ok");
  });

  it("does not claim outdated when the installed version is ahead of a stale clone", () => {
    const r = row({
      enabled_project: true,
      latest_version: "0.24.0",
      installs: install("0.25.1"),
    });
    expect(pluginStatus(r)).toBe("ok");
  });

  it("says unknown when the clone offers no version to compare", () => {
    const r = row({ enabled_project: true, latest_version: "", installs: install("0.24.0") });
    expect(pluginStatus(r)).toBe("unknown");
  });

  it("counts either scope as enabled", () => {
    const r = row({ tier: "required", scope: "either", enabled_user: true });
    expect(pluginStatus(r)).toBe("pending");
  });
});

describe("pluginViews", () => {
  it("puts what needs a decision first and keeps catalog order within a status", () => {
    const rows = [
      row({ name: "ok-one", enabled_project: true, installs: [{ scope: "project", version: "1.0.0", project_path: "", install_path: ""  }] }),
      row({ name: "off-one" }),
      row({ name: "outdated-one", enabled_project: true, latest_version: "2.0.0", installs: [{ scope: "project", version: "1.0.0", project_path: "", install_path: ""  }] }),
      row({ name: "missing-one", tier: "required" }),
      row({ name: "advised-one", tier: "recommended" }),
    ];
    expect(pluginViews(state(rows)).map((v) => v.name)).toEqual([
      "missing-one",
      "outdated-one",
      "advised-one",
      "ok-one",
      "off-one",
    ]);
  });

  it("orders equal-status rows required, recommended, optional", () => {
    // Every row is `ok`, which is the ordinary case: the status key decides
    // nothing and the tier has to. Written here in the catalog order the tab
    // used to fall through to, with the recommended one listed last.
    const ok = { enabled_user: true, scope: "user" as const };
    const installs = [{ scope: "user", version: "1.0.0", project_path: "", install_path: ""  }];
    const rows = [
      row({ name: "req", tier: "required", ...ok, installs }),
      row({ name: "opt", tier: "optional", ...ok, installs }),
      row({ name: "rec", tier: "recommended", ...ok, installs }),
    ];
    const views = pluginViews(state(rows));
    expect(views.map((v) => v.status)).toEqual(["ok", "ok", "ok"]);
    expect(views.map((v) => v.name)).toEqual(["req", "rec", "opt"]);
  });

  it("sinks an uncatalogued row below catalogued ones of the same status", () => {
    const rows = [
      row({ name: "leftover", in_catalog: false, scope: "" }),
      row({ name: "listed" }),
    ];
    const views = pluginViews(state(rows));
    expect(views.map((v) => v.name)).toEqual(["listed", "leftover"]);
    expect(views[1].extra).toBe(true);
  });

  it("carries the resolved scope and installed version onto the view", () => {
    const rows = [
      row({
        name: "persona",
        scope: "either",
        enabled_user: true,
        installs: [{ scope: "user", version: "0.3.0", project_path: "", install_path: ""  }],
        latest_version: "0.3.0",
      }),
    ];
    const [view] = pluginViews(state(rows));
    expect(view.effective_scope).toBe("user");
    expect(view.installed_version).toBe("0.3.0");
    expect(view.enabled).toBe(true);
    expect(view.status).toBe("ok");
  });
});

describe("pluginProblems", () => {
  it("keeps only the rows worth acting on", () => {
    const rows = [
      row({ name: "missing-one", tier: "required" }),
      row({ name: "off-one" }),
      row({ name: "advised-one", tier: "recommended" }),
      row({
        name: "outdated-one",
        enabled_project: true,
        latest_version: "2.0.0",
        installs: [{ scope: "project", version: "1.0.0", project_path: "", install_path: ""  }],
      }),
    ];
    const views = pluginViews(state(rows));
    expect(pluginProblems(views).map((p) => p.name)).toEqual(["missing-one", "outdated-one"]);
    // A recommended plugin left off is a choice, not a problem to fix.
    expect(pluginSuggestions(views).map((p) => p.name)).toEqual(["advised-one"]);
  });
});


/**
 * A marketplace with no `catalog.json` makes no claim about what the owner
 * ought to have (T-0238), so none of the judgements built on a tier may fire
 * for its rows. Getting this wrong would put "Required, off" on somebody
 * else's plugin — a demand the app has no standing to make.
 */
describe("marketplaces without a catalog", () => {
  const marketplaces = [
    marketplace(),
    marketplace({ name: "claude-plugins-official", catalog_found: false }),
  ];

  const foreign = (over = {}) =>
    row({
      marketplace: "claude-plugins-official",
      in_catalog: false,
      tier: "",
      scope: "",
      latest_version: "",
      ...over,
    });

  it("never calls an uncatalogued row missing or advised", () => {
    // Same shape that would read as `missing` from the workhub marketplace.
    expect(pluginStatus(row({ tier: "required" }), true)).toBe("missing");
    expect(pluginStatus(row({ tier: "required" }), false)).toBe("off");
    expect(pluginStatus(row({ tier: "recommended" }), false)).toBe("off");
  });

  it("still reports what it can: installed, outdated, pending", () => {
    const rows = [
      foreign({
        name: "pyright-lsp",
        enabled_user: true,
        latest_version: "2.0.0",
        installs: [
          { scope: "user", version: "1.0.0", project_path: "", install_path: "C:/p" },
        ],
      }),
      // Switched on, nothing on disk yet.
      foreign({ name: "rust-analyzer-lsp", enabled_user: true }),
    ];
    const views = pluginViews(state(rows, marketplaces));
    expect(views.map((v) => [v.name, v.status])).toEqual([
      ["pyright-lsp", "outdated"],
      ["rust-analyzer-lsp", "pending"],
    ]);
  });

  it("does not flag an uncatalogued row as absent from the catalog", () => {
    // `extra` drives a "Not in catalog" badge — a complaint about a file that
    // was never meant to exist for this marketplace.
    const [view] = pluginViews(state([foreign({ enabled_user: true })], marketplaces));
    expect(view.extra).toBe(false);
    expect(view.catalogued).toBe(false);
  });

  it("resolves the scope from where the plugin actually is", () => {
    const [view] = pluginViews(
      state(
        [
          foreign({
            enabled_user: true,
            installs: [
              { scope: "user", version: "1.0.0", project_path: "", install_path: "" },
            ],
          }),
        ],
        marketplaces,
      ),
    );
    expect(view.effective_scope).toBe("user");
  });
});

describe("pluginsOfMarketplace", () => {
  it("splits the rows by the marketplace they came from", () => {
    const marketplaces = [
      marketplace(),
      marketplace({ name: "superpowers-dev", catalog_found: false }),
    ];
    const rows = [
      row({ name: "workhub", enabled_user: true, latest_version: "" }),
      row({
        name: "superpowers",
        marketplace: "superpowers-dev",
        in_catalog: false,
        tier: "",
        scope: "",
        latest_version: "",
        enabled_user: true,
      }),
    ];
    const views = pluginViews(state(rows, marketplaces));
    expect(pluginsOfMarketplace(views, "workhub-marketplace").map((v) => v.name)).toEqual([
      "workhub",
    ]);
    expect(pluginsOfMarketplace(views, "superpowers-dev").map((v) => v.name)).toEqual([
      "superpowers",
    ]);
    expect(pluginsOfMarketplace(views, "genshijin")).toEqual([]);
  });
});
