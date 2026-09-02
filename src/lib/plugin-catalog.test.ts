/**
 * Guards the plugin catalog against drift, in CI.
 *
 * `.claude-plugin/catalog.json` says which plugins a vault cannot work without
 * and at which scope each is installed — metadata Claude Code itself never
 * reads, and which therefore has nothing else keeping it honest. It is worth
 * having only as long as it agrees with the three places that describe the same
 * plugins: `marketplace.json` (what exists), each `plugin.json` (what version),
 * and `docs/plugins.md` (what a human is told).
 *
 * A plugin added, removed or re-classified in one place and not the others
 * fails here rather than silently misinforming the app's Plugins tab.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

interface CatalogEntry {
  name: string;
  required: boolean;
  scope: "project" | "user" | "either";
  summary: string;
}

const catalog: { plugins: CatalogEntry[] } = JSON.parse(
  readFileSync(join(root, ".claude-plugin", "catalog.json"), "utf8"),
);
const marketplace: { plugins: { name: string; source: string }[] } = JSON.parse(
  readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
);

/**
 * The plugin rows of the catalog table in `docs/plugins.md`, keyed by name.
 * The table's first column is the plugin in backticks, the second says
 * required or optional, the third is the scope.
 */
function docRows(): Map<string, { required: boolean; scope: string }> {
  const doc = readFileSync(join(root, "docs", "plugins.md"), "utf8");
  const rows = new Map<string, { required: boolean; scope: string }>();
  for (const line of doc.split(/\r?\n/)) {
    const match = /^\|\s*`([a-z0-9-]+)`\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (!match) continue;
    const [, name, requiredCell, scopeCell] = match;
    const scopeText = scopeCell.toLowerCase();
    // "project or user" is the prose form of `either`; "project (vault)" and
    // "**user**" are the plain scopes with an aside or emphasis attached.
    const scope = scopeText.includes(" or ")
      ? "either"
      : scopeText.includes("user")
        ? "user"
        : "project";
    rows.set(name, { required: /required/i.test(requiredCell), scope });
  }
  return rows;
}

describe("plugin catalog", () => {
  it("lists exactly the plugins the marketplace declares", () => {
    const inCatalog = catalog.plugins.map((p) => p.name).sort();
    const inMarketplace = marketplace.plugins.map((p) => p.name).sort();
    expect(inCatalog).toEqual(inMarketplace);
  });

  it("lists each plugin once", () => {
    const names = catalog.plugins.map((p) => p.name);
    expect(names).toEqual([...new Set(names)]);
  });

  it("gives every entry a usable required flag, scope and summary", () => {
    for (const entry of catalog.plugins) {
      expect(typeof entry.required, entry.name).toBe("boolean");
      expect(["project", "user", "either"], entry.name).toContain(entry.scope);
      expect(entry.summary.trim(), entry.name).not.toBe("");
    }
  });

  it("carries no version or description — plugin.json is the single source", () => {
    for (const entry of catalog.plugins) {
      const keys = Object.keys(entry);
      expect(keys, entry.name).not.toContain("version");
      expect(keys, entry.name).not.toContain("description");
      expect(keys, entry.name).not.toContain("author");
    }
  });

  it("points at a plugin.json that exists and declares a version", () => {
    for (const entry of marketplace.plugins) {
      const manifest = join(root, entry.source, ".claude-plugin", "plugin.json");
      expect(existsSync(manifest), `${entry.name}: ${manifest}`).toBe(true);
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      expect(parsed.name, entry.name).toBe(entry.name);
      expect(parsed.version, entry.name).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("agrees with the catalog table in docs/plugins.md", () => {
    const docs = docRows();
    for (const entry of catalog.plugins) {
      const doc = docs.get(entry.name);
      expect(doc, `${entry.name} is missing from the docs/plugins.md table`).toBeDefined();
      expect(doc?.required, `${entry.name}: required flag`).toBe(entry.required);
      expect(doc?.scope, `${entry.name}: scope`).toBe(entry.scope);
    }
    expect([...docs.keys()].sort()).toEqual(catalog.plugins.map((p) => p.name).sort());
  });
});
