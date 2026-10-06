import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  globToRegExp,
  loadExtendedRules,
  loadMatchingRules,
  matchesExtendedGlob,
  matchesGlob,
  normalizePath,
} from "../../vault-template/.opencode/plugins/lib/project-context-core";

describe("zero-depth double-star globs", () => {
  it("matches a leading double star at the root", () => {
    expect(matchesGlob("WebRole/a.vb", "**/WebRole/**")).toBe(true);
    expect(matchesGlob("x/WebRole/a.vb", "**/WebRole/**")).toBe(true);
  });

  it("matches a middle double star with zero directories", () => {
    expect(matchesGlob("src/a.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("src/b/c/a.ts", "src/**/*.ts")).toBe(true);
    expect(matchesGlob("srcx/a.ts", "src/**/*.ts")).toBe(false);
  });

  it("keeps the extended matcher root-anchored but zero-depth", () => {
    expect(matchesExtendedGlob("workhub/src/a.ts", "workhub/src/**/*.ts")).toBe(true);
    expect(matchesExtendedGlob("other/workhub/src/a.ts", "workhub/src/**/*.ts")).toBe(false);
    expect(globToRegExp("a/**").test("a/b/c")).toBe(true);
  });
});

describe("rules in subfolders", () => {
  let root = "";

  beforeAll(() => {
    root = normalizePath(mkdtempSync(join(tmpdir(), "opencode-rules-")));
    mkdirSync(join(root, ".claude", "rules", "nested"), { recursive: true });
    writeFileSync(join(root, ".claude", "rules", "top.md"), "Top rule.\n");
    writeFileSync(
      join(root, ".claude", "rules", "nested", "deep.md"),
      "---\npaths: src/**/*.tsx\n---\nNested rule.\n",
    );
    mkdirSync(join(root, ".claude", "rules-ex", "group"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "rules-ex", "group", "ex.md"),
      "---\npaths: workhub/src/**/*.ts\n---\nExtended nested.\n",
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads a nested rule and honours its paths", () => {
    expect(loadMatchingRules(root, "src/app.tsx").map((r) => r.path.slice(root.length))).toEqual([
      "/.claude/rules/nested/deep.md",
      "/.claude/rules/top.md",
    ]);
    expect(loadMatchingRules(root, "src/app.css").map((r) => r.path.slice(root.length))).toEqual([
      "/.claude/rules/top.md",
    ]);
  });

  it("reads a nested rules-ex rule", () => {
    expect(loadExtendedRules(root, ["workhub/src/a.ts"]).map((r) => r.path.slice(root.length))).toEqual([
      "/.claude/rules-ex/group/ex.md",
    ]);
  });
});
