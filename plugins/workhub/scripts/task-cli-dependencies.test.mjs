/**
 * `task-cli` and task dependencies (`depends_on`).
 *
 * The rules mirror `unresolved_deps` / `would_create_cycle` / `check_startable`
 * in `src-tauri/src/tasks.rs`: a predecessor is open until its status is
 * `done`, a loop is refused, and starting a waiting task needs `--force`.
 * Like the other CLI tests these drive the real command line.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./task-cli.mjs", import.meta.url));

let vault;

function seed({ id, title, status = "todo", deps }) {
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
    ...(deps ? [`depends_on: [${deps.join(", ")}]`] : []),
    "created: 2026-01-01",
    "updated: 2026-01-01",
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

/** Run expecting a non-zero exit; returns stderr + stdout. */
function runFails(...args) {
  try {
    run(...args);
  } catch (e) {
    return `${e.stderr ?? ""}${e.stdout ?? ""}`;
  }
  throw new Error(`expected task-cli ${args.join(" ")} to fail`);
}

function fileOf(id) {
  const name = readdirSync(join(vault, "tasks")).find((n) => n.startsWith(`${id} `));
  return readFileSync(join(vault, "tasks", name), "utf-8");
}

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "task-cli-deps-"));
  mkdirSync(join(vault, "tasks", "archive"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
});

describe("--depends-on", () => {
  it("writes the list on create and puts it in the index", () => {
    seed({ id: "T-0001", title: "first" });
    const created = JSON.parse(
      run("create", "--title", "second", "--depends-on", "T-0001, T-0001", "--json"),
    );
    expect(fileOf(created.id)).toContain("depends_on: [T-0001]\n");
    const index = JSON.parse(readFileSync(join(vault, "_ai", "index", "tasks.json"), "utf-8"));
    expect(index.find((t) => t.id === created.id).depends_on).toEqual(["T-0001"]);
  });

  it("replaces the list on update and clears it with an empty value", () => {
    seed({ id: "T-0001", title: "first" });
    seed({ id: "T-0002", title: "second" });
    seed({ id: "T-0003", title: "third", deps: ["T-0001"] });
    run("update", "T-0003", "--depends-on", "T-0001,T-0002");
    expect(fileOf("T-0003")).toContain("depends_on: [T-0001, T-0002]\n");
    run("update", "T-0003", "--depends-on", "");
    expect(fileOf("T-0003")).not.toContain("depends_on");
  });

  it("refuses a self reference and a loop, and writes nothing", () => {
    seed({ id: "T-0001", title: "first" });
    seed({ id: "T-0002", title: "second", deps: ["T-0001"] });
    seed({ id: "T-0003", title: "third", deps: ["T-0002"] });
    expect(runFails("update", "T-0001", "--depends-on", "T-0001")).toContain("cycle");
    expect(runFails("update", "T-0001", "--depends-on", "T-0003")).toContain("cycle");
    expect(fileOf("T-0001")).not.toContain("depends_on");
  });

  it("keeps the other carried-through keys when it rewrites the list", () => {
    seed({ id: "T-0001", title: "first" });
    seed({ id: "T-0002", title: "second" });
    run("update", "T-0002", "--blocked", "true", "--blocked-note", "vendor");
    run("update", "T-0002", "--depends-on", "T-0001");
    const raw = fileOf("T-0002");
    expect(raw).toContain("blocked: true\n");
    expect(raw).toContain("blocked_note: vendor\n");
    expect(raw).toContain("depends_on: [T-0001]\n");
  });
});

describe("starting a waiting task", () => {
  it("is refused while a predecessor is open, and names it", () => {
    seed({ id: "T-0001", title: "first", status: "doing" });
    seed({ id: "T-0002", title: "second", deps: ["T-0001"] });
    const out = runFails("start", "T-0002");
    expect(out).toContain("T-0001");
    expect(fileOf("T-0002")).toContain("status: todo");
    expect(runFails("update", "T-0002", "--status", "doing")).toContain("T-0001");
    expect(fileOf("T-0002")).toContain("status: todo");
  });

  it("goes through with --force", () => {
    seed({ id: "T-0001", title: "first", status: "doing" });
    seed({ id: "T-0002", title: "second", deps: ["T-0001"] });
    run("start", "T-0002", "--force");
    expect(fileOf("T-0002")).toContain("status: doing");
  });

  it("clears by itself once the predecessor is done", () => {
    seed({ id: "T-0001", title: "first", status: "done" });
    seed({ id: "T-0002", title: "second", deps: ["T-0001", "T-9999"] });
    run("start", "T-0002");
    expect(fileOf("T-0002")).toContain("status: doing");
  });

  it("does not stop other status changes", () => {
    seed({ id: "T-0001", title: "first", status: "doing" });
    seed({ id: "T-0002", title: "second", deps: ["T-0001"] });
    run("update", "T-0002", "--status", "inbox");
    expect(fileOf("T-0002")).toContain("status: inbox");
  });
});

describe("list", () => {
  it("shows the open predecessors", () => {
    seed({ id: "T-0001", title: "first", status: "doing" });
    seed({ id: "T-0002", title: "second", deps: ["T-0001"] });
    const out = run("list");
    expect(out).toContain("waiting-on");
    expect(out.split("\n").find((l) => l.startsWith("T-0002"))).toContain("T-0001");
  });
});
