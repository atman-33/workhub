/**
 * Helpers for task dependencies — tasks that cannot start until others finish.
 *
 * This is a different axis from `blocked`: `blocked` is a flag a person sets
 * for an external wait, while a dependency is derived. The only thing stored is
 * the list of predecessor ids (`depends_on`); whether a task is waiting is
 * recomputed from the predecessors' `status` every time, so it clears by
 * itself the moment they reach `done`.
 *
 * The authority is Rust: `check_startable` in tasks.rs decides whether a task
 * may start (it refuses even a `done` task with an open predecessor) and
 * `would_create_cycle` guards what is saved. This file only mirrors those rules
 * for display and for narrowing the predecessor picker, where a synchronous
 * answer is needed; it never decides a launch.
 */

import type { Task } from "@/types";

/**
 * Predecessors of `task` that are still open. One that is `done` — archived or
 * not — counts as finished, and an id that matches no task is ignored, so a
 * deleted predecessor never pins a task forever.
 */
export function unresolvedDeps(task: Task, all: readonly Task[]): Task[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  const open: Task[] = [];
  for (const id of task.depends_on) {
    const dep = byId.get(id);
    if (dep && dep.status !== "done") open.push(dep);
  }
  return open;
}

/** Whether giving `id` the predecessors `deps` would close a loop. */
export function wouldCreateCycle(id: string, deps: readonly string[], all: readonly Task[]): boolean {
  const byId = new Map(all.map((t) => [t.id, t]));
  const stack = [...deps];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(byId.get(cur)?.depends_on ?? []));
  }
  return false;
}

/** Tasks that may be added as a predecessor of `id`: anything that would not
 *  close a loop, is not `id` itself and is not already listed. */
export function dependencyCandidates(
  id: string,
  current: readonly string[],
  all: readonly Task[],
): Task[] {
  return all.filter(
    (t) => t.id !== id && !current.includes(t.id) && !wouldCreateCycle(id, [t.id], all),
  );
}
