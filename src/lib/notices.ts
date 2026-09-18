import { compareVersions } from "@/lib/plugins";
import type { Notice } from "@/types";

/**
 * Plugins that are missing, unreadable, or too old for a notice's action
 * (T-0377), as `"<name> <min>+"` strings ready to show.
 *
 * **A version that could not be read counts as unmet.** The action files a
 * task telling an agent to run a skill; a task pointing at a skill that is not
 * installed is worse than no task at all, because it looks actionable, fails
 * part-way, and leaves the vault in whatever state it reached. Guessing
 * optimistically here would trade a clear "update this first" for a migration
 * that stops halfway.
 */
export function unmetRequirements(
  notice: Notice,
  versions: Record<string, string>,
): string[] {
  return Object.entries(notice.requires?.plugin ?? {})
    .filter(([name, min]) => {
      const installed = versions[name] ?? "";
      return !installed || compareVersions(installed, min) < 0;
    })
    .map(([name, min]) => `${name} ${min}+`);
}
