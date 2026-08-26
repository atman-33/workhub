import type { Task, TaskStatus, VaultProject, VaultProjectIssue } from "@/types";

/**
 * Pure helpers behind the Projects tab (T-0190).
 *
 * The backend reports what a project folder holds; everything here turns that
 * report into the two judgements the screen makes — how healthy a project is,
 * and how the vault's projects line up with the tasks that claim to belong to
 * them. Both are pure functions over data the view already has, which is why
 * they live outside the component and are tested directly.
 */

/** Statuses a project's task counts are broken down by, in board order. */
export const TASK_STATUSES: TaskStatus[] = ["inbox", "todo", "doing", "review", "done"];

export interface Health {
  warn: number;
  info: number;
}

/** Counts a project's findings by severity. A project with no warnings is
 * shown as healthy even when it still has notes against it — a missing
 * `research/` folder is not a problem, just an absence. */
export function health(project: VaultProject): Health {
  let warn = 0;
  let info = 0;
  for (const issue of project.issues) {
    if (issue.severity === "warn") warn += 1;
    else info += 1;
  }
  return { warn, info };
}

/** One-line wording for a finding. Kept next to the health calculation so the
 * kinds the backend emits and the words the UI shows cannot drift apart. */
export function issueLabel(issue: VaultProjectIssue): string {
  switch (issue.kind) {
    case "missing-file":
      return `${issue.target} is missing`;
    case "missing-folder":
      return `${issue.target} is missing`;
    case "misfiled-deliverable":
      return `${issue.target} belongs in deliverables/`;
    case "unknown-folder":
      return `${issue.target} is not in the documented layout`;
    default:
      return issue.target;
  }
}

export type TaskCounts = Record<TaskStatus, number> & { total: number };

function emptyCounts(): TaskCounts {
  return { inbox: 0, todo: 0, doing: 0, review: 0, done: 0, total: 0 };
}

/**
 * Task counts per `project:` value, keyed exactly as the tasks spell it.
 *
 * Deliberately not normalised (no case folding, no slugifying): a task whose
 * `project:` differs from the folder name only by case is a typo the tab is
 * meant to surface, and normalising it here would hide the very thing being
 * looked for.
 */
export function taskCountsByProject(tasks: Task[]): Map<string, TaskCounts> {
  const out = new Map<string, TaskCounts>();
  for (const task of tasks) {
    const key = task.project.trim();
    if (!key) continue;
    const counts = out.get(key) ?? emptyCounts();
    counts[task.status] += 1;
    counts.total += 1;
    out.set(key, counts);
  }
  return out;
}

export interface UnknownProject {
  project: string;
  counts: TaskCounts;
}

/**
 * `project:` values used by tasks that no vault project folder answers to.
 *
 * This is the mismatch the tab exists to catch: the task board accepts free
 * text, so a typo produces a project nobody will ever find again, and a repo
 * renamed on disk quietly orphans every task still naming the old one.
 */
export function unknownProjects(tasks: Task[], projects: VaultProject[]): UnknownProject[] {
  const known = new Set(projects.map((p) => p.slug));
  const out: UnknownProject[] = [];
  for (const [project, counts] of taskCountsByProject(tasks)) {
    if (!known.has(project)) out.push({ project, counts });
  }
  out.sort((a, b) => b.counts.total - a.counts.total || a.project.localeCompare(b.project));
  return out;
}

/**
 * Registered repository path a project points at, or null when the link is
 * unset or names a repo that is no longer registered.
 *
 * Matched on the stored path first and the repo's display name second, so a
 * link recorded by hand in Obsidian ("repo: workhub") works as well as one
 * made from the picker.
 */
export function linkedRepo<T extends { path: string; name: string }>(
  project: VaultProject,
  repos: T[],
): T | null {
  const want = project.repo.trim();
  if (!want) return null;
  const normalized = want.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return (
    repos.find((r) => r.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === normalized) ??
    repos.find((r) => r.name.toLowerCase() === want.toLowerCase()) ??
    null
  );
}
