import { describe, expect, it } from "vitest";
import type { Task, VaultProject, VaultProjectIssue } from "@/types";
import {
  buildProjectFixPrompt,
  health,
  issueLabel,
  linkedRepos,
  projectOfNotePath,
  taskCountsByProject,
  unknownProjects,
} from "./vault-project";

function project(over: Partial<VaultProject> = {}): VaultProject {
  return {
    slug: "demo",
    name: "Demo",
    path: "C:/vault/projects/demo",
    status: "active",
    repos: [],
    summary: "",
    updated: 0,
    folders: [],
    issues: [],
    archived: false,
    ...over,
  };
}

function issue(over: Partial<VaultProjectIssue> = {}): VaultProjectIssue {
  return { kind: "missing-file", severity: "info", target: "prd.md", ...over };
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: "T-0001",
    title: "a task",
    status: "todo",
    assignee: "me",
    project: "demo",
    priority: "medium",
    model: "",
    order: null,
    due: "",
    tags: [],
    created: "2026-08-01",
    updated: "2026-08-01",
    file: "C:/vault/tasks/T-0001 a task.md",
    body: "",
    archived: false,
    blocked: false,
    blocked_note: "",
    blocked_since: "",
    confirm: false,
    worktree: false,
    ...over,
  } as Task;
}

describe("health", () => {
  it("separates warnings from notes", () => {
    const p = project({
      issues: [
        issue({ severity: "warn", kind: "missing-file", target: "README.md" }),
        issue({ severity: "warn", kind: "misfiled-deliverable", target: "T-0042-x.md" }),
        issue({ severity: "info", kind: "missing-folder", target: "specs/" }),
      ],
    });
    expect(health(p)).toEqual({ warn: 2, info: 1 });
  });

  it("reports a clean project as having nothing at all", () => {
    expect(health(project())).toEqual({ warn: 0, info: 0 });
  });
});

describe("issueLabel", () => {
  it("says what to do about a misfiled deliverable", () => {
    expect(issueLabel(issue({ kind: "misfiled-deliverable", target: "T-0042-x.md" }))).toBe(
      "T-0042-x.md belongs in deliverables/",
    );
  });

  it("names an undocumented folder as such", () => {
    expect(issueLabel(issue({ kind: "unknown-folder", target: "pbl/" }))).toBe(
      "pbl/ is not in the documented layout",
    );
  });
});

describe("buildProjectFixPrompt", () => {
  it("is empty for a project that matches the layout", () => {
    expect(buildProjectFixPrompt(project())).toBe("");
  });

  it("lists every finding with its severity, kind and one-line wording", () => {
    const prompt = buildProjectFixPrompt(
      project({
        issues: [
          issue({ kind: "missing-file", severity: "warn", target: "README.md" }),
          issue({ kind: "unknown-folder", severity: "info", target: "pbl/" }),
        ],
      }),
    );
    expect(prompt).toContain("- [warn] missing-file: README.md — README.md is missing");
    expect(prompt).toContain(
      "- [info] unknown-folder: pbl/ — pbl/ is not in the documented layout",
    );
  });

  it("names the project and its folder", () => {
    const prompt = buildProjectFixPrompt(project({ issues: [issue()] }));
    expect(prompt).toContain('"demo"');
    expect(prompt).toContain("C:/vault/projects/demo");
  });

  it("says so when the project is archived", () => {
    const prompt = buildProjectFixPrompt(
      project({
        archived: true,
        path: "C:/vault/archive/projects/demo",
        issues: [issue()],
      }),
    );
    expect(prompt).toContain("C:/vault/archive/projects/demo");
    expect(prompt).toContain("archived");
  });

  it("forbids deleting and forbids empty scaffold folders", () => {
    const prompt = buildProjectFixPrompt(project({ issues: [issue()] }));
    expect(prompt).toContain("Never delete a file or a folder");
    expect(prompt).toContain("Do not create empty");
  });
});

describe("taskCountsByProject", () => {
  it("counts per status and totals them", () => {
    const counts = taskCountsByProject([
      task({ project: "demo", status: "todo" }),
      task({ project: "demo", status: "doing" }),
      task({ project: "demo", status: "doing" }),
      task({ project: "other", status: "done" }),
    ]);
    expect(counts.get("demo")).toMatchObject({ todo: 1, doing: 2, total: 3 });
    expect(counts.get("other")).toMatchObject({ done: 1, total: 1 });
  });

  it("ignores tasks with no project", () => {
    expect(taskCountsByProject([task({ project: "  " })]).size).toBe(0);
  });
});

describe("unknownProjects", () => {
  it("reports task project values no folder answers to, busiest first", () => {
    const found = unknownProjects(
      [
        task({ project: "demo" }),
        task({ project: "typo-project" }),
        task({ project: "ghost" }),
        task({ project: "ghost" }),
      ],
      [project()],
    );
    expect(found.map((u) => u.project)).toEqual(["ghost", "typo-project"]);
    expect(found[0].counts.total).toBe(2);
  });

  it("treats a case difference as unknown — that is the typo being looked for", () => {
    const found = unknownProjects([task({ project: "Demo" })], [project({ slug: "demo" })]);
    expect(found.map((u) => u.project)).toEqual(["Demo"]);
  });
});

describe("linkedRepos", () => {
  const repos = [
    { path: "C:/repos/multi-agent-ff15-vscode", name: "multi-agent-ff15-vscode" },
    { path: "C:/repos/workhub", name: "workhub" },
  ];

  it("matches a stored path regardless of separators and trailing slash", () => {
    const p = project({ repos: ["C:\\repos\\workhub\\"] });
    expect(linkedRepos(p, repos)[0].repo?.name).toBe("workhub");
  });

  it("falls back to the repo name, which is how a hand-written link reads", () => {
    const p = project({ repos: ["multi-agent-ff15-vscode"] });
    expect(linkedRepos(p, repos)[0].repo?.path).toBe("C:/repos/multi-agent-ff15-vscode");
  });

  it("keeps file order, so the first entry stays the project's default", () => {
    const p = project({ repos: ["workhub", "multi-agent-ff15-vscode"] });
    expect(linkedRepos(p, repos).map((l) => l.repo?.name)).toEqual([
      "workhub",
      "multi-agent-ff15-vscode",
    ]);
  });

  // Dropping it would render a stale link as "no repository", which hides the
  // one thing the screen has to report.
  it("keeps an entry naming a repo that is gone, resolved to null", () => {
    const links = linkedRepos(project({ repos: ["C:/repos/deleted"] }), repos);
    expect(links).toEqual([{ entry: "C:/repos/deleted", repo: null }]);
  });

  it("is empty for an unset link", () => {
    expect(linkedRepos(project({ repos: [] }), repos)).toEqual([]);
    expect(linkedRepos(project({ repos: ["  "] }), repos)).toEqual([]);
  });
});

describe("projectOfNotePath", () => {
  it("reads the slug out of a note path, either separator", () => {
    expect(projectOfNotePath("C:/vault/projects/demo/schedules/plan.md")).toBe("demo");
    expect(projectOfNotePath("C:\\vault\\projects\\demo\\mindmaps\\ideas.md")).toBe("demo");
  });

  it("takes the last `projects` segment, so a vault called projects still works", () => {
    expect(projectOfNotePath("C:/projects/vault/projects/demo/mindmaps/a.md")).toBe("demo");
  });

  it("returns nothing for a path outside a project", () => {
    expect(projectOfNotePath("")).toBe("");
    expect(projectOfNotePath("C:/vault/tasks/T-0001 a.md")).toBe("");
  });
});
