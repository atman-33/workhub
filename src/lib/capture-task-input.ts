/** The task the quick-capture window creates.
 *
 * Kept out of the window component so the defaults it bakes in — above all
 * `confirm` — are a testable value rather than a literal buried in a submit
 * handler.
 */
import type { CapturePattern } from "@/lib/capture-patterns";
import type { CreateTaskInput } from "@/types";

export interface CaptureDraft {
  title: string;
  description: string;
  /** Vault project slug, empty when the capture is not filed under one. */
  project: string;
  /** Patterns recognized in the description; each becomes a tag. */
  matched: CapturePattern[];
}

export function captureTaskInput(draft: CaptureDraft): CreateTaskInput {
  return {
    title: draft.title.trim(),
    status: "inbox",
    assignee: "me",
    project: draft.project,
    // On by default, the same as a new task written in the editor (T-0285):
    // a captured task is the one most likely to be a one-line note, so having
    // the agent state its own read of it first is worth even more here. The
    // window itself has no toggle — it is the fast path, and the board's task
    // editor can turn it off afterwards.
    confirm: true,
    tags: draft.matched.map((p) => p.id),
    body: `\n## Description\n\n${draft.description.trim()}\n\n## Results\n`,
  };
}
