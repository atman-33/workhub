/**
 * `task-cli create` — the numbering has to match the app's, byte for byte.
 *
 * These are the rules from `src-tauri/src/tasks.rs` (`next_id`, `next_order`,
 * `sanitize_filename`, `create_task`). If the CLI and the app ever disagree
 * about the next id, an agent and the board hand the same number to two
 * different tasks and every link to one of them silently resolves to the
 * other — which is why this is tested rather than left to review.
 *
 * The CLI is a script with a top-level dispatch, so it cannot be imported;
 * these drive the real command line, which is also what the skills do.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./task-cli.mjs", import.meta.url));

let vault;

/** Write one task file into `tasks/` or `tasks/archive/`. */
function seed({ id, title, status = "todo", order, archived = false }) {
  const dir = archived ? join(vault, "tasks", "archive") : join(vault, "tasks");
  const front = [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    `status: ${status}`,
    "assignee: me",
    "project: ",
    "priority: medium",
    ...(order === undefined ? [] : [`order: ${order}`]),
    "due: ",
    "tags: []",
    ...(archived ? ["archived: true"] : []),
    "created: 2026-01-01",
    "updated: 2026-01-01",
    "---",
    "",
    "## Description",
    "",
  ].join("\n");
  writeFileSync(join(dir, `${id} ${title}.md`), front, "utf-8");
}

/** Run `task-cli create` against the fixture vault; returns stdout. */
function create(...args) {
  return execFileSync(process.execPath, [CLI, "create", "--vault", vault, ...args], {
    encoding: "utf-8",
  });
}

/** Run it expecting a non-zero exit; returns the combined stderr. */
function createFails(...args) {
  try {
    create(...args);
  } catch (e) {
    return `${e.stderr ?? ""}${e.stdout ?? ""}`;
  }
  throw new Error("expected task-cli create to fail");
}

function created(...args) {
  return JSON.parse(create(...args, "--json"));
}

beforeEach(() => {
  vault = mkdtempSync(join(os.tmpdir(), "task-cli-test-"));
  mkdirSync(join(vault, "tasks", "archive"), { recursive: true });
  mkdirSync(join(vault, "_ai"), { recursive: true });
});

describe("id", () => {
  it("takes the next number after the highest existing one", () => {
    seed({ id: "T-0005", title: "alpha", order: 1 });
    seed({ id: "T-0009", title: "beta", order: 2 });
    expect(created("--title", "gamma").id).toBe("T-0010");
  });

  // The archive is scanned too: an archived task still owns its number.
  it("does not reuse an archived task's id", () => {
    seed({ id: "T-0005", title: "alpha", order: 1 });
    seed({ id: "T-0042", title: "old", status: "review", order: 1, archived: true });
    expect(created("--title", "next").id).toBe("T-0043");
  });

  it("starts at T-0001 in an empty vault", () => {
    expect(created("--title", "first").id).toBe("T-0001");
  });
});

describe("order", () => {
  // Appended to the end of its own column, so the tasks already in other
  // columns must not push it down.
  it("continues the target status column only", () => {
    seed({ id: "T-0001", title: "a", status: "todo", order: 3 });
    seed({ id: "T-0002", title: "b", status: "doing", order: 9 });
    expect(created("--title", "c", "--status", "todo").order).toBe(4);
  });

  it("starts at 1 for an empty column", () => {
    seed({ id: "T-0001", title: "a", status: "doing", order: 9 });
    expect(created("--title", "c", "--status", "todo").order).toBe(1);
  });
});

describe("the file", () => {
  it("replaces characters a filename cannot carry", () => {
    const task = created("--title", 'a/b:c*d?e"f<g>h|i');
    expect(task.file.endsWith("T-0001 a-b-c-d-e-f-g-h-i.md")).toBe(true);
  });

  it("falls back to untitled when nothing survives sanitizing", () => {
    expect(created("--title", "///").file.endsWith("T-0001 ---.md")).toBe(true);
    expect(created("--title", " . ").file.endsWith("T-0002 untitled.md")).toBe(true);
  });

  it("writes the three empty sections by default", () => {
    const task = created("--title", "plain");
    expect(readFileSync(task.file, "utf-8")).toContain(
      "---\n\n## Description\n\n## Plan\n\n## Results\n",
    );
  });

  it("puts --body-file under Description, leaving Plan and Results empty", () => {
    const body = join(vault, "body.md");
    writeFileSync(body, "why this task exists\n\nsee C:/repos/workhub\n", "utf-8");
    const task = created("--title", "with body", "--body-file", body);
    expect(readFileSync(task.file, "utf-8")).toContain(
      "\n## Description\n\nwhy this task exists\n\nsee C:/repos/workhub\n\n## Plan\n\n## Results\n",
    );
  });

  // `confirm` and `worktree` are not in KNOWN_KEYS, so they ride the `extra`
  // lines — which is exactly where the documented schema puts them.
  it("writes confirm and worktree between archived and created", () => {
    const task = created("--title", "flags", "--confirm", "--worktree");
    expect(readFileSync(task.file, "utf-8")).toContain(
      "tags: []\nconfirm: true\nworktree: true\ncreated:",
    );
  });

  it("carries the optional fields through", () => {
    const task = created(
      "--title",
      "full",
      "--project",
      "workhub",
      "--assignee",
      "claude-code",
      "--priority",
      "high",
      "--status",
      "todo",
      "--due",
      "2026-12-01",
      "--model",
      "sonnet",
      "--tags",
      "a, b",
    );
    expect(task).toMatchObject({
      project: "workhub",
      assignee: "claude-code",
      priority: "high",
      status: "todo",
      due: "2026-12-01",
      model: "sonnet",
      tags: ["a", "b"],
    });
  });

  it("defaults to an inbox task assigned to the owner", () => {
    expect(created("--title", "d")).toMatchObject({
      status: "inbox",
      assignee: "me",
      priority: "medium",
      tags: [],
    });
  });
});

describe("refusals", () => {
  it("will not create a done task", () => {
    expect(createFails("--title", "x", "--status", "done")).toMatch(/status 'done'/);
    expect(readdirSync(join(vault, "tasks"))).toEqual(["archive"]);
  });

  it("rejects a status that is not on the board", () => {
    expect(createFails("--title", "x", "--status", "oops")).toMatch(/unknown status/);
  });

  it("needs a title", () => {
    expect(createFails("--project", "workhub")).toMatch(/--title/);
  });

  it("says so when --body-file does not exist", () => {
    expect(createFails("--title", "x", "--body-file", join(vault, "nope.md"))).toMatch(
      /cannot read --body-file/,
    );
  });
});

it("refreshes the task index", () => {
  seed({ id: "T-0001", title: "a", order: 1 });
  const task = created("--title", "b", "--status", "todo");
  const index = JSON.parse(readFileSync(join(vault, "_ai", "index", "tasks.json"), "utf-8"));
  expect(index.map((t) => t.id)).toEqual(["T-0001", task.id]);
  // Paths in the index are vault-relative, like the app writes them.
  expect(index[1].file).toBe(`tasks/${task.id} b.md`);
});
