/**
 * The worktree guard (T-0389): a worktree is created without a question only
 * when the session's task sets `worktree: true`. What is pinned here is which
 * calls count as "creating a worktree" and that the owner is asked in every
 * other case — including a session with no task at all.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeTaskWorktree, createsWorktree } from "./lib.mjs";

const hook = join(dirname(fileURLToPath(import.meta.url)), "worktree-guard.mjs");

describe("createsWorktree", () => {
  const bash = (command) => createsWorktree("Bash", { command });

  it("catches git worktree add, with or without global options", () => {
    expect(bash("git worktree add ../wt -b task/T-1")).toBe(true);
    expect(bash("git -C C:/repos/workhub worktree add C:/wt/T-1/workhub -b task/T-1")).toBe(true);
    expect(bash('git -C "C:/My Repos/app" worktree add ../wt')).toBe(true);
    expect(bash("cd /c/repos/workhub && git fetch -q && git worktree add x origin/main")).toBe(true);
  });

  it("leaves other git commands alone", () => {
    expect(bash("git worktree list")).toBe(false);
    expect(bash("git worktree remove C:/wt/T-1/workhub")).toBe(false);
    expect(bash("git switch -c task/T-1 origin/main")).toBe(false);
    expect(bash("echo worktree add")).toBe(false);
  });

  it("catches EnterWorktree and worktree-isolated agents", () => {
    expect(createsWorktree("EnterWorktree", {})).toBe(true);
    expect(createsWorktree("Agent", { isolation: "worktree" })).toBe(true);
    expect(createsWorktree("Agent", { prompt: "x" })).toBe(false);
    expect(createsWorktree("Read", { file_path: "x" })).toBe(false);
  });
});

describe("worktree guard", () => {
  let vault;

  beforeEach(() => {
    vault = mkdtempSync(join(os.tmpdir(), "workhub-worktree-guard-"));
    mkdirSync(join(vault, "_ai", "state", "sessions"), { recursive: true });
    mkdirSync(join(vault, "tasks"));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  function startTask(sessionId, id, worktreeLine) {
    const file = `tasks/${id} demo.md`;
    writeFileSync(
      join(vault, file),
      `---\nid: ${id}\ntitle: demo\nstatus: doing\n${worktreeLine}created: 2026-09-19\n---\n\n## Description\n`,
    );
    writeFileSync(
      join(vault, "_ai", "state", "sessions", `${sessionId}.json`),
      JSON.stringify({ session_id: sessionId, id, file }),
    );
  }

  function run(sessionId, command = "git worktree add ../wt") {
    const result = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ session_id: sessionId, tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8",
      env: { ...process.env, WORKHUB_VAULT: vault },
    });
    expect(result.status).toBe(0);
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  }

  it("reads the flag off the session's task", () => {
    startTask("s-on", "T-1", "worktree: true\n");
    startTask("s-off", "T-2", "worktree: false\n");
    startTask("s-unset", "T-3", "");
    expect(activeTaskWorktree(vault, "s-on")).toEqual({ id: "T-1", worktree: true });
    expect(activeTaskWorktree(vault, "s-off")).toEqual({ id: "T-2", worktree: false });
    expect(activeTaskWorktree(vault, "s-unset")).toEqual({ id: "T-3", worktree: false });
    expect(activeTaskWorktree(vault, "nobody")).toBeNull();
  });

  it("lets a worktree: true task through", () => {
    startTask("s-on", "T-1", "worktree: true\n");
    expect(run("s-on")).toBeNull();
  });

  it("asks when the task leaves worktree off", () => {
    startTask("s-off", "T-2", "");
    const out = run("s-off");
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("T-2");
  });

  it("asks when the session has no task", () => {
    const out = run("no-task");
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("stays out of unrelated commands", () => {
    expect(run("no-task", "git status")).toBeNull();
  });
});
