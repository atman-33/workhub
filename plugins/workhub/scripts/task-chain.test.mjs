/**
 * `task-chain` — preflight, detaching and restoring `depends_on`, and the
 * review check on `mark`. Drives the real command line, like the other CLI tests.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CHAIN = fileURLToPath(new URL("./task-chain.mjs", import.meta.url));

let vault;

function seed({ id, title, status = "todo", deps, extra = [] }) {
  const front = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `status: ${status}`,
    "assignee: claude-code",
    "project: ",
    "priority: medium",
    "due: ",
    "tags: []",
    ...extra,
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
  return execFileSync(process.execPath, [CHAIN, ...args, "--vault", vault], { encoding: "utf-8" });
}

function runFails(...args) {
  try {
    run(...args);
  } catch (e) {
    return `${e.stderr ?? ""}${e.stdout ?? ""}`;
  }
  throw new Error("expected a non-zero exit");
}

const taskText = (id, title) => readFileSync(join(vault, "tasks", `${id} ${title}.md`), "utf-8");
const state = () => JSON.parse(readFileSync(join(vault, "_ai", "state", "task-chain.json"), "utf-8"));

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "task-chain-"));
  mkdirSync(join(vault, "tasks"));
  mkdirSync(join(vault, "_ai"));
});

describe("preflight", () => {
  it("labels where each open predecessor sits", () => {
    seed({ id: "T-0001", title: "a" });
    seed({ id: "T-0002", title: "b", deps: ["T-0001"] });
    seed({ id: "T-0003", title: "c", deps: ["T-0009"], extra: ["confirm: true"] });
    seed({ id: "T-0009", title: "z" });
    const out = JSON.parse(run("preflight", "T-0001", "T-0002", "T-0003"));
    expect(out.tasks[1].deps).toEqual([{ id: "T-0001", status: "todo", where: "earlier" }]);
    expect(out.tasks[2].confirm).toBe(true);
    expect(out.tasks[2].problems[0]).toMatch(/outside the chain/);
  });

  it("flags blocked tasks and a predecessor that comes later", () => {
    seed({ id: "T-0001", title: "a", deps: ["T-0002"], extra: ["blocked: true"] });
    seed({ id: "T-0002", title: "b" });
    const t = JSON.parse(run("preflight", "T-0001", "T-0002")).tasks[0];
    expect(t.problems).toEqual(expect.arrayContaining(["blocked", expect.stringMatching(/comes later/)]));
  });
});

describe("init / mark / finish", () => {
  beforeEach(() => {
    seed({ id: "T-0001", title: "a" });
    seed({ id: "T-0002", title: "b", deps: ["T-0001"] });
  });

  it("refuses a waiting task unless it is detached", () => {
    expect(runFails("init", "T-0001", "T-0002")).toMatch(/add it to --detach/);
  });

  it("detaches in-chain predecessors, records them, and restores them on finish", () => {
    run("init", "T-0001", "T-0002", "--detach", "T-0002");
    expect(taskText("T-0002", "b")).not.toMatch(/depends_on/);
    expect(state().detached).toEqual({ "T-0002": ["T-0001"] });

    run("finish");
    expect(taskText("T-0002", "b")).toMatch(/depends_on: \[T-0001\]/);
    expect(state().finished).toBe(true);
  });

  it("walks the chain and halts after a failure", () => {
    run("init", "T-0001", "T-0002", "--detach", "T-0002");
    expect(JSON.parse(run("next")).next).toBe("T-0001");
    run("mark", "T-0001", "failed", "--note", "permission denied");
    const next = JSON.parse(run("next"));
    expect(next.next).toBeNull();
    expect(next.halted).toBe("T-0001");
  });

  it("accepts review only when the task file says review", () => {
    run("init", "T-0001", "T-0002", "--detach", "T-0002");
    expect(runFails("mark", "T-0001", "review")).toMatch(/not review/);
    seed({ id: "T-0001", title: "a", status: "review" });
    run("mark", "T-0001", "review");
    expect(JSON.parse(run("next")).next).toBe("T-0002");
  });

  it("refuses a chain longer than the limit", () => {
    expect(runFails("init", "T-0001", "T-0002", "--max", "1", "--detach", "T-0002")).toMatch(/exceed the limit/);
  });

  it("records the confirm mode per task", () => {
    seed({ id: "T-0003", title: "c", extra: ["confirm: true"] });
    run("init", "T-0001", "T-0003", "--delegate", "T-0003");
    expect(state().confirm).toEqual({ "T-0003": "delegate" });
  });
});
