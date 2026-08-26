/**
 * A request from one tab to another: "select this, and do it now".
 *
 * The Projects tab is the only source today — its Tasks / Schedule / Mindmap /
 * Repo buttons hand the receiving view the project slug (or repository path)
 * to focus on. The counter is what makes the request repeatable: the same
 * value asked for twice is still two requests, and a receiving view that has
 * since been navigated elsewhere has to honour the second one.
 */
export interface TabFocus {
  /** Project slug, or repository path for the Repos tab. */
  value: string;
  /** Incremented per request; the receiving effect keys on it. */
  n: number;
}
