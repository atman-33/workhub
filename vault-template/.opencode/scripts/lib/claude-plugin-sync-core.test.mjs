// @ts-check
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  computeToolBucketDrift,
  copyToolToTarget,
  discoverUserScopeSources,
  hashArtifact,
  hashDirectory,
  hashFile,
  hashToolSource,
  hashToolTarget,
  workhubPluginRoot,
} from "./claude-plugin-sync-core.mjs";

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

describe("custom tools", () => {
  let pluginRoot = "";
  let ocRoot = "";

  const listOutput = [
    "> workhub@workhub-marketplace",
    "  Version: 0.50.10",
    "  Scope: user",
    "  Status: enabled",
    "",
  ].join("\n");

  function writeTool(rel, content) {
    const abs = join(pluginRoot, "workhub-marketplace", "plugins", "workhub", "opencode-tools", rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return abs;
  }

  beforeEach(() => {
    pluginRoot = mkdtempSync(join(tmpdir(), "workhub-plugin-root-"));
    ocRoot = mkdtempSync(join(tmpdir(), "workhub-oc-root-"));
    writeTool("tools/show-image.ts", "export default 1;\n");
    writeTool("lib/img-daemon.ts", "daemon 1\n");
  });

  afterEach(() => {
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(ocRoot, { recursive: true, force: true });
  });

  function discover() {
    return discoverUserScopeSources({
      claudePluginsRoot: pluginRoot,
      openCodeGlobalRoot: ocRoot,
      listOutput,
      enabledRefs: new Set(["workhub@workhub-marketplace"]),
    });
  }

  it("discovers tools from the workhub plugin only", () => {
    const { toolsSources, targets } = discover();
    expect(toolsSources).toHaveLength(1);
    expect(toolsSources[0]).toMatchObject({ kind: "tool", name: "show-image.ts" });
    expect(targets.toolsTarget.endsWith("tools")).toBe(true);
    expect(targets.toolsLibTarget.endsWith("lib")).toBe(true);
  });

  it("copies the tool file plus companion lib files", () => {
    const { toolsSources, targets } = discover();
    const result = copyToolToTarget(toolsSources[0], targets.toolsTarget, targets.toolsLibTarget, false);
    expect(result.copied).toBe(true);
    expect(readFileSync(join(targets.toolsTarget, "show-image.ts"), "utf8")).toBe("export default 1;\n");
    expect(readFileSync(join(targets.toolsLibTarget, "img-daemon.ts"), "utf8")).toBe("daemon 1\n");
    // Second copy without --force leaves the target alone (hand-edit safe).
    expect(copyToolToTarget(toolsSources[0], targets.toolsTarget, targets.toolsLibTarget, false)).toEqual({
      copied: false,
      reason: "exists",
    });
  });

  it("hashes lib companions but ignores unrelated files in the global lib/", () => {
    const { toolsSources, targets } = discover();
    copyToolToTarget(toolsSources[0], targets.toolsTarget, targets.toolsLibTarget, false);
    const before = hashToolTarget(
      join(targets.toolsTarget, "show-image.ts"),
      targets.toolsLibTarget,
      toolsSources[0].libDir,
    );
    writeFileSync(join(targets.toolsLibTarget, "other-tool-helper.ts"), "unrelated\n");
    expect(
      hashToolTarget(join(targets.toolsTarget, "show-image.ts"), targets.toolsLibTarget, toolsSources[0].libDir),
    ).toBe(before);
    // A shipped companion change moves the source hash.
    const sourceBefore = hashToolSource(toolsSources[0].sourcePath, toolsSources[0].libDir);
    writeTool("lib/img-daemon.ts", "daemon 2\n");
    expect(hashToolSource(toolsSources[0].sourcePath, toolsSources[0].libDir)).not.toBe(sourceBefore);
  });

  it("reports synced then stale-source through computeToolBucketDrift", () => {
    const { toolsSources, targets } = discover();
    expect(
      computeToolBucketDrift({
        sources: toolsSources,
        toolsTargetDir: targets.toolsTarget,
        libTargetDir: targets.toolsLibTarget,
        manifestBucket: {},
      })[0].status,
    ).toBe("missing");
    copyToolToTarget(toolsSources[0], targets.toolsTarget, targets.toolsLibTarget, false);
    const source = toolsSources[0];
    const manifestBucket = {
      [`${source.kind}/${source.name}`]: {
        pluginRef: source.pluginRef,
        kind: source.kind,
        name: source.name,
        sourceHash: hashToolSource(source.sourcePath, source.libDir),
        targetHash: hashToolTarget(
          join(targets.toolsTarget, source.name),
          targets.toolsLibTarget,
          source.libDir,
        ),
        copiedAt: "2026-11-03T00:00:00.000Z",
      },
    };
    const synced = computeToolBucketDrift({
      sources: toolsSources,
      toolsTargetDir: targets.toolsTarget,
      libTargetDir: targets.toolsLibTarget,
      manifestBucket,
    });
    expect(synced[0].status).toBe("synced");
    writeTool("lib/img-daemon.ts", "daemon 2\n");
    const stale = computeToolBucketDrift({
      sources: toolsSources,
      toolsTargetDir: targets.toolsTarget,
      libTargetDir: targets.toolsLibTarget,
      manifestBucket,
    });
    expect(stale[0].status).toBe("stale-source");
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
