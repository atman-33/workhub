import { describe, expect, it } from "vitest";
import {
  compareVersions,
  effectiveScope,
  installedVersion,
  pluginProblems,
  pluginStatus,
  pluginViews,
} from "@/lib/plugins";
import type { PluginRow, PluginsState } from "@/types";

function row(over: Partial<PluginRow> = {}): PluginRow {
  return {
    name: "workhub",
    in_catalog: true,
    required: false,
    scope: "project",
    summary: "",
    latest_version: "1.0.0",
    installs: [],
    enabled_project: false,
    enabled_user: false,
    ...over,
  };
}

function state(rows: PluginRow[]): PluginsState {
  return {
    marketplace: "workhub-marketplace",
    clone_path: "C:/clone",
    clone_found: true,
    catalog_found: true,
    marketplace_updated: "",
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
      installs: [{ scope: "project", version: "1.0.0", project_path: "C:/vault" }],
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
        { scope: "user", version: "1.0.0", project_path: "" },
        { scope: "project", version: "2.0.0", project_path: "C:/vault" },
      ],
    });
    expect(installedVersion(r, "project")).toBe("2.0.0");
    expect(installedVersion(r, "user")).toBe("1.0.0");
  });

  it("reports an install at another scope rather than claiming nothing", () => {
    const r = row({ installs: [{ scope: "user", version: "1.0.0", project_path: "" }] });
    expect(installedVersion(r, "project")).toBe("1.0.0");
  });

  it("is empty when the plugin is not installed at all", () => {
    expect(installedVersion(row(), "user")).toBe("");
  });
});

describe("pluginStatus", () => {
  const install = (version: string) => [{ scope: "project", version, project_path: "C:/v" }];

  it("flags a required plugin that is switched off", () => {
    expect(pluginStatus(row({ required: true }))).toBe("missing");
  });

  it("leaves an optional plugin that is switched off alone", () => {
    expect(pluginStatus(row({ required: false }))).toBe("off");
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
    const r = row({ required: true, scope: "either", enabled_user: true });
    expect(pluginStatus(r)).toBe("pending");
  });
});

describe("pluginViews", () => {
  it("puts what needs a decision first and keeps catalog order within a status", () => {
    const rows = [
      row({ name: "ok-one", enabled_project: true, installs: [{ scope: "project", version: "1.0.0", project_path: "" }] }),
      row({ name: "off-one" }),
      row({ name: "outdated-one", enabled_project: true, latest_version: "2.0.0", installs: [{ scope: "project", version: "1.0.0", project_path: "" }] }),
      row({ name: "missing-one", required: true }),
    ];
    expect(pluginViews(state(rows)).map((v) => v.name)).toEqual([
      "missing-one",
      "outdated-one",
      "ok-one",
      "off-one",
    ]);
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
        installs: [{ scope: "user", version: "0.3.0", project_path: "" }],
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
      row({ name: "missing-one", required: true }),
      row({ name: "off-one" }),
      row({
        name: "outdated-one",
        enabled_project: true,
        latest_version: "2.0.0",
        installs: [{ scope: "project", version: "1.0.0", project_path: "" }],
      }),
    ];
    const problems = pluginProblems(pluginViews(state(rows)));
    expect(problems.map((p) => p.name)).toEqual(["missing-one", "outdated-one"]);
  });
});
