/**
 * `init-team-context` keeps the machine-local config out of git without
 * touching a tracked file (T-0381).
 *
 * The project root is wherever the session was opened, which in a workhub
 * setup is usually the vault. Its `.gitignore` belongs to the app's template
 * and is rewritten on every update, so a line appended there does not survive
 * one — the identical team-comms config reached a vault's history that way.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./init-team-context.mjs", import.meta.url));

const git = (dir, ...args) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

function project({ repo = true } = {}) {
  const base = mkdtempSync(join(os.tmpdir(), "team-ops-"));
  const root = join(base, "project");
  const team = join(base, "team");
  mkdirSync(root, { recursive: true });
  mkdirSync(team, { recursive: true });
  if (repo) {
    git(root, "init", "-q");
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "t");
  }
  return { root, team };
}

function init({ root, team }) {
  const out = execFileSync(process.execPath, [SCRIPT, "--team-root", team, "--me", "t"], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return JSON.parse(out);
}

describe("init-team-context", () => {
  it("ignores the config through .git/info/exclude and leaves .gitignore alone", () => {
    const p = project();
    writeFileSync(join(p.root, ".gitignore"), "node_modules/\n");

    init(p);

    expect(git(p.root, "check-ignore", ".claude/team-context.json")).toBe(
      ".claude/team-context.json",
    );
    expect(readFileSync(join(p.root, ".gitignore"), "utf8")).toBe("node_modules/\n");
  });

  it("does not add the line twice", () => {
    const p = project();
    init(p);
    init(p);
    const lines = readFileSync(join(p.root, ".git", "info", "exclude"), "utf8")
      .split("\n")
      .filter((l) => l.trim() === "/.claude/team-context.json");
    expect(lines).toHaveLength(1);
  });

  it("warns, with the fix, when the config is already tracked", () => {
    const p = project();
    init(p);
    git(p.root, "add", "-f", ".claude/team-context.json");
    git(p.root, "commit", "-qm", "oops");

    const result = init(p);
    expect(result.warning).toContain("is tracked by git");
    expect(result.warning).toContain("rm --cached .claude/team-context.json");
  });

  it("works outside a git repository and says nothing about git", () => {
    const result = init(project({ repo: false }));
    expect(result.warning).toBeUndefined();
  });
});
