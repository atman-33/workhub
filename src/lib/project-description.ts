/**
 * Helpers for the Projects tab Description field (T-0713).
 *
 * The field shows the README frontmatter `description` when set, otherwise the
 * first README body paragraph cut by `SUMMARY_CHARS` with "…" appended (see
 * `excerpt` in `src-tauri/src/vault_project.rs`). It is never the whole
 * README, so the textarea auto-grows to fit its content and says so when the
 * text is a cut-off excerpt.
 */

/** The ellipsis the backend appends when it cuts a README excerpt. */
export const EXCERPT_ELLIPSIS = "…";

/** Floor of the auto-growing description textarea, matching `min-h-16`. */
export const DESCRIPTION_MIN_HEIGHT_PX = 64;

/** Ceiling of the auto-growing description textarea, matching `max-h-48`. */
export const DESCRIPTION_MAX_HEIGHT_PX = 192;

/**
 * Whether the description looks like a README excerpt cut short: the backend
 * appends "…" exactly when the first paragraph exceeds `SUMMARY_CHARS`. A
 * hand-written frontmatter description that happens to end in "…" reads as
 * truncated too, which is acceptable — it is still not the full README.
 */
export function isTruncatedExcerpt(summary: string): boolean {
  return summary.endsWith(EXCERPT_ELLIPSIS);
}

/**
 * Fits a measured `scrollHeight` into the textarea's growth range: never below
 * the CSS floor, never above the ceiling past which the field scrolls
 * instead. NaN (an unmounted element measures nothing) falls back to the
 * floor so the field keeps a stable height.
 */
export function clampAutoGrowHeight(
  scrollHeight: number,
  minHeight: number = DESCRIPTION_MIN_HEIGHT_PX,
  maxHeight: number = DESCRIPTION_MAX_HEIGHT_PX,
): number {
  if (!Number.isFinite(scrollHeight)) return minHeight;
  return Math.min(Math.max(scrollHeight, minHeight), maxHeight);
}
