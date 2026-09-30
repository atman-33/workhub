import { describe, expect, it } from "vitest";
import { dependencyCandidates, unresolvedDeps, wouldCreateCycle } from "@/lib/task-dependencies";
import type { Task } from "@/types";

function task(id: string, status: Task["status"], depends_on: string[] = []): Task {
  return {
    id,
    title: `title ${id}`,
    status,
    assignee: "me",
    project: "",
    backlog: "",
    priority: "medium",
    model: "",
    order: null,
    due: "",
    tags: [],
    archived: false,
    confirm: false,
    worktree: false,
    blocked: false,
    blocked_note: "",
    blocked_since: "",
    depends_on,
    created: "2026-10-01",
    updated: "2026-10-01",
    file: `tasks/${id}.md`,
    body: "",
  };
}

describe("unresolvedDeps", () => {
  it("lists predecessors that are not done", () => {
    const all = [task("T-1", "doing"), task("T-2", "review"), task("T-3", "done")];
    const waiting = task("T-4", "todo", ["T-1", "T-2", "T-3"]);
    expect(unresolvedDeps(waiting, all).map((t) => t.id)).toEqual(["T-1", "T-2"]);
  });

  it("clears itself once every predecessor is done", () => {
    const all = [task("T-1", "done"), task("T-2", "done")];
    expect(unresolvedDeps(task("T-3", "todo", ["T-1", "T-2"]), all)).toEqual([]);
  });

  it("ignores an id that matches no task", () => {
    expect(unresolvedDeps(task("T-2", "todo", ["T-404"]), [])).toEqual([]);
  });

  it("is empty for a task with no predecessors", () => {
    expect(unresolvedDeps(task("T-1", "todo"), [task("T-2", "doing")])).toEqual([]);
  });
});

describe("wouldCreateCycle", () => {
  const all = [task("T-1", "todo"), task("T-2", "todo", ["T-1"]), task("T-3", "todo", ["T-2"])];

  it("refuses a self reference", () => {
    expect(wouldCreateCycle("T-1", ["T-1"], all)).toBe(true);
  });

  it("refuses a two-step and a three-step loop", () => {
    expect(wouldCreateCycle("T-1", ["T-2"], all)).toBe(true);
    expect(wouldCreateCycle("T-1", ["T-3"], all)).toBe(true);
  });

  it("allows a chain and a diamond", () => {
    expect(wouldCreateCycle("T-3", ["T-1", "T-2"], all)).toBe(false);
    expect(wouldCreateCycle("T-4", ["T-3"], all)).toBe(false);
  });
});

describe("dependencyCandidates", () => {
  it("leaves out itself, current predecessors and anything that would close a loop", () => {
    const all = [
      task("T-1", "todo"),
      task("T-2", "todo", ["T-1"]),
      task("T-3", "todo", ["T-2"]),
      task("T-4", "todo"),
    ];
    // T-1 may not depend on T-2/T-3 (loop) or itself; T-4 is free.
    expect(dependencyCandidates("T-1", [], all).map((t) => t.id)).toEqual(["T-4"]);
    expect(dependencyCandidates("T-4", ["T-1"], all).map((t) => t.id)).toEqual(["T-2", "T-3"]);
  });
});
