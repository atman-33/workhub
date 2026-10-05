import type { Task } from "@/types";

/** Splits a query into lowercase terms; blank input yields none. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * True when every term appears in the task's id, title, project, backlog id or
 * a tag. Task bodies are not loaded on the board, so they are not searched.
 */
export function matchesTaskSearch(task: Task, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [task.id, task.title, task.project, task.backlog, ...task.tags]
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
