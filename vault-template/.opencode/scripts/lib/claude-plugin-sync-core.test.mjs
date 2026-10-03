// @ts-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashArtifact, hashDirectory, hashFile, workhubPluginRoot } from "./claude-plugin-sync-core.mjs";

/**
 * Drift detection hashes a synced artifact to decide whether the target was
 * edited by hand. A skill that writes scratch output into its own install
 * directory therefore used to read as a hand edit on every run — the real case
 * being `create-pull-request`, which documents writing to its own `.tmp/`.
 *
 * These tests pin both directions: declared runtime artifacts must not move the
 * hash, and anything that is actually shipped content must still move it.
 */

let root = "";
let skill = "";

/** @param {string} rel @param {string} content */
function write(rel, content) {
  const abs = join(skill, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "workhub-plugin-sync-hash-"));
  skill = join(root, "demo-skill");
  mkdirSync(skill, { recursive: true });
  write("SKILL.md", "# demo\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("hashDirectory", () => {
  it("is stable for identical trees", () => {
    write("scripts/run.mjs", "export const x = 1;\n");
    const first = hashDirectory(skill);
    expect(hashDirectory(skill)).toBe(first);
  });

  it("moves when shipped content changes", () => {
    write("scripts/run.mjs", "export const x = 1;\n");
    const before = hashDirectory(skill);
    write("SKILL.md", "# demo changed\n");
    expect(hashDirectory(skill)).not.toBe(before);
  });

  it("moves when a shipped file is added", () => {
    const before = hashDirectory(skill);
    write("REFERENCE.md", "ref\n");
    expect(hashDirectory(skill)).not.toBe(before);
  });

  it("moves when a file is removed", () => {
    write("REFERENCE.md", "ref\n");
    const before = hashDirectory(skill);
    rmSync(join(skill, "REFERENCE.md"));
    expect(hashDirectory(skill)).not.toBe(before);
  });
});

describe("runtime artifacts", () => {
  it("ignores scratch the skill declares via `X/*`", () => {
    write(".gitignore", "# generated\n.tmp/*\n!.tmp/.gitkeep\n");
    const before = hashDirectory(skill);
    write(".tmp/pr-body.md", "# draft\n");
    write(".tmp/analysis.json", "{}\n");
    expect(hashDirectory(skill)).toBe(before);
  });

  it("ignores scratch the skill declares via a directory pattern", () => {
    write(".gitignore", "__pycache__/\n");
    const before = hashDirectory(skill);
    write("__pycache__/mod.cpython-312.pyc", "bytecode\n");
    expect(hashDirectory(skill)).toBe(before);
  });

  it("ignores a declared bare file name at any depth", () => {
    write(".gitignore", "config.json\n");
    const before = hashDirectory(skill);
    write("config.json", "{}\n");
    expect(hashDirectory(skill)).toBe(before);
  });

  it("ignores nested node_modules without a .gitignore", () => {
    const before = hashDirectory(skill);
    write("scripts/node_modules/dep/index.js", "module.exports = 1;\n");
    expect(hashDirectory(skill)).toBe(before);
  });

  it("ignores a nested .git directory without a .gitignore", () => {
    const before = hashDirectory(skill);
    write("vendor/repo/.git/HEAD", "ref: refs/heads/main\n");
    expect(hashDirectory(skill)).toBe(before);
  });

  it("still hashes the .gitignore itself, since it is shipped", () => {
    write(".gitignore", "config.json\n");
    const before = hashDirectory(skill);
    write(".gitignore", "config.json\nother.json\n");
    expect(hashDirectory(skill)).not.toBe(before);
  });

  it("does not extend a declared ignore to sibling content", () => {
    write(".gitignore", ".tmp/*\n");
    const before = hashDirectory(skill);
    write(".tmp-scratch/note.md", "not the declared dir\n");
    expect(hashDirectory(skill)).not.toBe(before);
  });
});

describe("unsupported gitignore syntax", () => {
  it("skips negations rather than half-honouring them", () => {
    // `!.tmp/.gitkeep` alone must not make `.tmp` content count as shipped.
    write(".gitignore", "!.tmp/.gitkeep\n");
    const before = hashDirectory(skill);
    write(".tmp/pr-body.md", "# draft\n");
    expect(hashDirectory(skill)).not.toBe(before);
  });

  it("keeps counting files matched only by a general glob", () => {
    write(".gitignore", "*.log\n");
    const before = hashDirectory(skill);
    write("run.log", "output\n");
    expect(hashDirectory(skill)).not.toBe(before);
  });
});

describe("hashArtifact", () => {
  it("dispatches a directory to hashDirectory and a file to hashFile", () => {
    write(".gitignore", ".tmp/*\n");
    const before = hashArtifact(skill);
    write(".tmp/pr-body.md", "# draft\n");
    expect(hashArtifact(skill)).toBe(before);
    expect(hashArtifact(join(skill, "SKILL.md"))).toBe(hashFile(join(skill, "SKILL.md")));
  });

  it("returns an empty string for a path that does not exist", () => {
    expect(hashArtifact(join(root, "absent"))).toBe("");
  });
});

describe("workhubPluginRoot", () => {
  const saved = process.env.WORKHUB_PLUGIN_ROOT;
  afterEach(() => {
    if (saved === undefined) delete process.env.WORKHUB_PLUGIN_ROOT;
    else process.env.WORKHUB_PLUGIN_ROOT = saved;
  });

  it("resolves under the marketplace checkout by default", () => {
    delete process.env.WORKHUB_PLUGIN_ROOT;
    expect(workhubPluginRoot("m/root").split("\\").join("/")).toBe(
      "m/root/workhub-marketplace/plugins/workhub",
    );
  });

  it("lets WORKHUB_PLUGIN_ROOT override", () => {
    process.env.WORKHUB_PLUGIN_ROOT = "/custom/workhub";
    expect(workhubPluginRoot("ignored")).toBe("/custom/workhub");
  });
});
