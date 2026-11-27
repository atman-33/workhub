/**
 * `task-cli archive <id>`: the CLI half of archiving, the same result the app
 * produces — `archived: true` and the file moved under `tasks/archive/`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./task-cli.mjs", import.meta.url));

let vault;

function seed(id, title) {
  const front = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "status: review",
    "assignee: me",
    "project: ",
    "priority: medium",
    "due: ",
    "tags: []",
    "created: 2026-01-01",
    "updated: 2026-01-01",
    "---",
    "",
    "## Description",
    "",
    "kept as is",
    "",
  ].join("\n");
  writeFileSync(join(vault, "tasks", `${id} ${title}.md`), front, "utf-8");
}

function run(...args) {
  return execFileSync(process.execPath, [CLI, ...args, "--vault", vault], { encoding: "utf-8" });
}

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "task-cli-archive-"));
  mkdirSync(join(vault, "tasks"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
});

describe("archive", () => {
  it("flags the task and moves it under tasks/archive/", () => {
    seed("T-0001", "old work");
    run("archive", "T-0001");
    const moved = join(vault, "tasks", "archive", "T-0001 old work.md");
    expect(existsSync(join(vault, "tasks", "T-0001 old work.md"))).toBe(false);
    const raw = readFileSync(moved, "utf-8");
    expect(raw).toContain("archived: true\n");
    expect(raw).toContain("kept as is");
    const entry = JSON.parse(readFileSync(join(vault, "_ai", "index", "tasks.json"), "utf-8"))[0];
    expect(entry.archived).toBe(true);
    expect(entry.file).toBe("tasks/archive/T-0001 old work.md");
  });

  it("is a no-op the second time", () => {
    seed("T-0001", "old work");
    run("archive", "T-0001");
    expect(run("archive", "T-0001")).toContain("already archived");
  });
});
