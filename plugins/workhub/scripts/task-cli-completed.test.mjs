/**
 * `task-cli` and the `completed` stamp (`YYYY-MM-DD HH:MM`, T-0727).
 *
 * The rules mirror `update_task` in `src-tauri/src/tasks.rs`: the stamp is
 * taken when `done` is entered, cleared when it is left, and never touched
 * otherwise — so a save that stays `done` keeps its existing value and an
 * old `done` task without one keeps none. Like the other CLI tests these
 * drive the real command line.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./task-cli.mjs", import.meta.url));

let vault;

function seed({ id, title, status = "todo", completed }) {
  const front = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `status: ${status}`,
    "assignee: me",
    "project: ",
    "priority: medium",
    "due: ",
    "tags: []",
    "created: 2026-01-01",
    "updated: 2026-01-01",
    ...(completed ? [`completed: ${completed}`] : []),
    "---",
    "",
    "## Description",
    "",
  ].join("\n");
  writeFileSync(join(vault, "tasks", `${id} ${title}.md`), front, "utf-8");
}

function run(...args) {
  return execFileSync(process.execPath, [CLI, ...args, "--vault", vault], { encoding: "utf-8" });
}

function fileOf(id) {
  const name = readdirSync(join(vault, "tasks")).find((n) => n.startsWith(`${id} `));
  return readFileSync(join(vault, "tasks", name), "utf-8");
}

function index() {
  return JSON.parse(readFileSync(join(vault, "_ai", "index", "tasks.json"), "utf-8"));
}

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "task-cli-completed-"));
  mkdirSync(join(vault, "tasks", "archive"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
});

describe("entering done", () => {
  it("stamps completed right after updated", () => {
    seed({ id: "T-0001", title: "finish me" });
    run("update", "T-0001", "--status", "done");
    const raw = fileOf("T-0001");
    const match = raw.match(/^completed: (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/m);
    expect(match).not.toBeNull();
    // `update` restamps `updated` to today; `completed` follows it directly.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamped = raw.match(/^updated: (.*)$/m)[1];
    expect(stamped).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    );
    expect(raw).toContain(`updated: ${stamped}\ncompleted: ${match[1]}\n---\n`);
    expect(index().find((t) => t.id === "T-0001").completed).toBe(match[1]);
  });

  it("a task that was never done carries no line", () => {
    seed({ id: "T-0001", title: "plain" });
    run("update", "T-0001", "--due", "2026-12-01");
    expect(fileOf("T-0001")).not.toContain("completed:");
  });
});

describe("staying done", () => {
  it("keeps the existing value instead of restamping", () => {
    seed({ id: "T-0001", title: "old done", status: "done", completed: "2026-01-02 03:04" });
    run("update", "T-0001", "--due", "2026-12-01");
    const raw = fileOf("T-0001");
    expect(raw).toContain("completed: 2026-01-02 03:04\n");
    expect(raw.match(/^completed: /gm)).toHaveLength(1);
  });

  it("leaves an old done task without a stamp alone", () => {
    seed({ id: "T-0001", title: "legacy", status: "done" });
    run("update", "T-0001", "--due", "2026-12-01");
    expect(fileOf("T-0001")).not.toContain("completed:");
  });
});

describe("leaving done", () => {
  it("clears the stamp and drops the line on update", () => {
    seed({ id: "T-0001", title: "reopened", status: "done", completed: "2026-01-02 03:04" });
    run("update", "T-0001", "--status", "doing");
    const raw = fileOf("T-0001");
    expect(raw).toContain("status: doing");
    expect(raw).not.toContain("completed:");
    expect(index().find((t) => t.id === "T-0001").completed).toBe("");
  });

  it("clears the stamp on report", () => {
    seed({ id: "T-0001", title: "reported", status: "done", completed: "2026-01-02 03:04" });
    run("report", "T-0001");
    const raw = fileOf("T-0001");
    expect(raw).toContain("status: review");
    expect(raw).not.toContain("completed:");
  });
});
