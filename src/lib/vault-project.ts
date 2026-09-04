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

/**
 * An AI agent prompt asking for this project's layout findings to be fixed,
 * ready to paste into a terminal. Empty when the project has nothing to fix.
 *
 * Built here rather than in the backend because every input is already on the
 * screen: the scan is deliberately report-only (see `vault_project.rs`), so
 * handing the findings to an agent is the repair path, and it needs no state
 * the view does not already hold.
 *
 * The prompt spends most of its length on what *not* to do. A finding is not
 * a work order — an absent `research/` folder is an absence, an unknown folder
 * may be deliberate — and an agent told only "fix these" answers with empty
 * scaffold folders and deleted notes.
 */
export function buildProjectFixPrompt(project: VaultProject): string {
  if (project.issues.length === 0) return "";
  const findings = project.issues
    .map((i) => `- [${i.severity}] ${i.kind}: ${i.target} — ${issueLabel(i)}`)
    .join("\n");
  const location = project.archived
    ? `${project.path} (this project is archived, under archive/projects/)`
    : project.path;
  return `Fix the layout findings for the vault project "${project.slug}".

Project folder: ${location}

Read the "Project layout" section of the vault's CLAUDE.md before changing
anything — it is the definition these findings are measured against.

Findings reported by the workhub Projects tab:

${findings}

How to handle them:

- Never delete a file or a folder. Move, create, or append only. If a finding
  cannot be resolved without deleting something, leave it alone and say so.
- warn findings are real gaps — fix them. A missing README.md or _index.md
  leaves an agent told to "read the README first" with nothing to read.
- info findings are judgement calls, not a checklist. Do not create empty
  folders to silence a missing-folder finding, and leave an unknown folder
  where it is unless its contents clearly belong somewhere in the documented
  layout.
- For a misfiled-deliverable, move the note into deliverables/ and update the
  link in the matching task's ## Results section so it still resolves.
- Base a new README.md, _index.md, or other scaffold file on templates/project/
  and fill it in from what the folder already contains. Do not leave the
  template's placeholders behind.
- Report what you changed and what you deliberately left as it is.

Run /kb-index when you are done so the project index matches the folder again.`;
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
 * Owning project slug of a note path (`…/projects/<slug>/<kind>/<name>.md`),
 * or `""` when the path is not under a project.
 *
 * Read back out of the path rather than kept in state because the case it
 * exists for is the note *leaving* the list: once a project is archived its
 * notes are gone from every listing, so the listing can no longer say which
 * project the still-open note belonged to.
 */
export function projectOfNotePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const at = parts.lastIndexOf("projects");
  if (at < 0) return "";
  return parts[at + 1] ?? "";
}

/**
 * The registered repository one `repos:` entry names, or null when no
 * registered repo answers to it.
 *
 * Matched on the stored path first and the repo's display name second, so a
 * link recorded by hand in Obsidian ("repos: [workhub]") works as well as one
 * made from the picker.
 */
export function resolveRepo<T extends { path: string; name: string }>(
  entry: string,
  repos: T[],
): T | null {
  const want = entry.trim();
  if (!want) return null;
  const normalized = want.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return (
    repos.find((r) => r.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === normalized) ??
    repos.find((r) => r.name.toLowerCase() === want.toLowerCase()) ??
    null
  );
}

/** One `repos:` entry paired with the registered repository it resolves to. */
export interface ProjectRepoLink<T> {
  /** The entry exactly as `_index.md` spells it. */
  entry: string;
  /** The registered repository, or null when the entry resolves to nothing. */
  repo: T | null;
}

/**
 * Every repository a project links to, in the order `_index.md` lists them —
 * the first is the project's default (T-0216).
 *
 * Unresolved entries are kept rather than dropped: a link naming a repo that
 * is no longer registered is exactly what the screen has to tell the owner
 * about, and a filtered list would show that as "no repository" instead.
 */
export function linkedRepos<T extends { path: string; name: string }>(
  project: VaultProject,
  repos: T[],
): ProjectRepoLink<T>[] {
  return project.repos
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => ({ entry, repo: resolveRepo(entry, repos) }));
}

// ---------------------------------------------------------------------
// pin / manual order (T-0231)
// ---------------------------------------------------------------------

/**
 * The order the list is shown in, matching `vault_project::sort_projects`
 * exactly — pinned first, then `order` ascending with the never-dragged
 * projects after them, then slug. Archived projects sort last.
 *
 * The backend already returns projects in this order; re-sorting here is what
 * lets the view work from a locally updated array without waiting for the
 * round trip, and having the rule written once on each side is deliberate —
 * the midpoint arithmetic below is only correct against *this* order.
 */
export function sortProjects(projects: VaultProject[]): VaultProject[] {
  return [...projects].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.slug.toLowerCase().localeCompare(b.slug.toLowerCase());
  });
}

/** One project's pin and position, as `api.setVaultProjectOrder` takes them. */
export interface ProjectOrderWrite {
  slug: string;
  pinned: boolean;
  order: number | null;
}

/**
 * Effective positions for midpoint arithmetic: a project with no `order` of
 * its own gets a synthetic one continuing the sequence, so the rows below an
 * un-dragged project are still separable.
 */
function effectiveOrders(group: VaultProject[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const p of group) {
    const e = p.order ?? prev + 1;
    out.push(e);
    prev = e;
  }
  return out;
}

/**
 * The writes that move `slug` to `index` within `group` — the destination
 * group (pinned or unpinned) in display order, which may or may not already
 * contain the dragged project.
 *
 * Normally one write: the new position is the midpoint between its neighbours,
 * so dragging a project rewrites that project's `_index.md` and nobody else's.
 * A whole-group renumber is only produced when the midpoint has nowhere left
 * to land — two neighbours that are equal or adjacent floats — which needs a
 * few thousand drags into the same gap to reach.
 *
 * An empty array means the drop changes nothing, and the caller should write
 * nothing rather than write the same values back.
 */
export function planProjectMove(
  group: VaultProject[],
  slug: string,
  index: number,
  pinned: boolean,
): ProjectOrderWrite[] {
  const dragged = group.find((p) => p.slug === slug);
  const eff = effectiveOrders(group);
  const from = group.findIndex((p) => p.slug === slug);
  const rows = group
    .map((p, i) => ({ p, e: eff[i] }))
    .filter(({ p }) => p.slug !== slug);

  // Dropping below its own row means one fewer row above it once it is lifted.
  let insert = index;
  if (from !== -1 && from < index) insert -= 1;
  if (from !== -1 && insert === from && dragged?.pinned === pinned) return [];

  const prev = insert > 0 ? rows[insert - 1].e : null;
  const next = insert < rows.length ? rows[insert].e : null;

  let order: number;
  if (prev === null && next === null) order = 1;
  else if (prev === null) order = (next as number) - 1;
  else if (next === null) order = prev + 1;
  else order = (prev + next) / 2;

  if (prev !== null && next !== null && !(order > prev && order < next)) {
    const finalRows = [
      ...rows.slice(0, insert).map(({ p }) => p),
      ...(dragged ? [dragged] : []),
      ...rows.slice(insert).map(({ p }) => p),
    ];
    return finalRows.map((p, i) => ({
      slug: p.slug,
      pinned: p.slug === slug ? pinned : p.pinned,
      order: i + 1,
    }));
  }

  return [{ slug, pinned, order }];
}
