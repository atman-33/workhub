import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { dueOccurrence, hasOpenTaskForRule, taskInputFromRule } from "@/lib/recurring";
import type { Task } from "@/types";

/** How often the app re-checks whether a rule is due. */
const TICK_MS = 5 * 60 * 1000;

export interface RecurringRunResult {
  /** Titles of the tasks created in this pass. */
  created: string[];
  /** Rule ids whose occurrence was skipped because a task is still open. */
  skipped: string[];
}

/**
 * Creates whatever the recurring rules owe (T-0110) and records the fired slot.
 *
 * Runs on app start and every tick, so an app opened at 10:00 still gets its
 * 09:00 task — `dueOccurrence` returns the last missed occurrence, and only
 * that one, so a week offline yields one task rather than seven.
 *
 * A slot is consumed (written to `last_generated`) both when the task is
 * created and when it is skipped for an already-open task; only a failed
 * create leaves it unconsumed, so the next tick retries it.
 */
export async function generateDueTasks(now: Date = new Date()): Promise<RecurringRunResult> {
  const result: RecurringRunResult = { created: [], skipped: [] };
  const cfg = await api.getConfig();
  const vault = cfg.settings.vault_path;
  const rules = cfg.settings.recurring ?? [];
  if (!vault || !rules.some((r) => r.enabled)) return result;

  let tasks: Task[];
  try {
    tasks = await api.listTasks(vault);
  } catch {
    // No reachable vault — try again on the next tick rather than burning slots.
    return result;
  }

  const fired = new Map<string, number>();
  for (const rule of rules) {
    const occurrence = dueOccurrence(rule, now);
    if (!occurrence) continue;
    const slot = Math.floor(occurrence.getTime() / 1000);
    if (rule.skip_if_open && hasOpenTaskForRule(rule, tasks)) {
      result.skipped.push(rule.id);
      fired.set(rule.id, slot);
      continue;
    }
    try {
      const task = await api.createTask(vault, taskInputFromRule(rule, occurrence));
      // Keep the local list current so two rules sharing a tag still see it.
      tasks.push(task);
      result.created.push(task.title);
      fired.set(rule.id, slot);
    } catch (e) {
      console.error(`recurring rule ${rule.id} failed to create its task`, e);
    }
  }

  if (fired.size > 0) {
    // Re-read before writing: the user may have changed settings while we ran.
    const latest = await api.getConfig();
    const merged = (latest.settings.recurring ?? []).map((r) =>
      fired.has(r.id) ? { ...r, last_generated: fired.get(r.id) as number } : r,
    );
    await api.saveConfig({
      ...latest,
      settings: { ...latest.settings, recurring: merged },
    });
  }
  return result;
}

/**
 * Mounts the recurring-task generator at the app root: once on start, once per
 * tick, and again whenever the settings are saved (a re-enabled or newly added
 * rule should not wait out a whole tick).
 */
export function useRecurringTasks(configVersion: number) {
  const running = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (running.current || cancelled) return;
      running.current = true;
      try {
        await generateDueTasks();
      } catch (e) {
        console.error("recurring task generation failed", e);
      } finally {
        running.current = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [configVersion]);
}
