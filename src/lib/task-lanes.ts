import type { Task } from "@/types";

/** One row of the board. `project` is `null` for the single ungrouped row,
 * otherwise the project slug (`""` for tasks without one). */
export type Lane = { key: string; project: string | null; tasks: Task[] };

/** Lanes for the project grouping: tasks' projects in `projectOrder`, then any
 * project the order does not know, with "no project" last. */
export function projectLanes(tasks: Task[], projectOrder: readonly string[]): Lane[] {
  const present = new Set(tasks.map((t) => t.project));
  const known = projectOrder.filter((p) => p !== "" && present.has(p));
  const unknown = [...present].filter((p) => p !== "" && !projectOrder.includes(p)).sort();
  const slugs = [...known, ...unknown, ...(present.has("") ? [""] : [])];
  return slugs.map((project) => ({
    key: `p:${project}`,
    project,
    tasks: tasks.filter((t) => t.project === project),
  }));
}
