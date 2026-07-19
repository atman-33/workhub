/** Capture patterns for the quick-capture window.
 *
 * The window exists so a link you want to come back to (a Slack message that
 * is about to get buried, a PR, a monday.com item) survives one hotkey press.
 * Only clipboard content that matches one of these patterns is auto-pasted
 * into the description — anything else waits behind the explicit paste button
 * so unrelated clipboard junk never lands in a task.
 *
 * Adding a source is a one-line change: append a pattern here and it drives
 * the auto-paste decision, the header badge, and the task tag at once.
 */

export type CapturePattern = {
  /** Stable id, also used as the task tag and the header badge label. */
  id: string;
  /** Matches anywhere in the text, mirroring how a link is usually copied. */
  re: RegExp;
};

export const CAPTURE_PATTERNS: CapturePattern[] = [
  // Slack message/thread links: https://<workspace>.slack.com/archives/...
  { id: "slack", re: /https?:\/\/[a-z0-9][a-z0-9-]*\.slack\.com\//i },
  // GitHub pull requests: https://github.com/<owner>/<repo>/pull/<number>
  {
    id: "github-pr",
    re: /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i,
  },
  // monday.com boards/pulses: https://<workspace>.monday.com/boards/...
  { id: "monday", re: /https?:\/\/[a-z0-9][a-z0-9-]*\.monday\.com\//i },
];

/** Every pattern present in `text`, in declaration order. Drives the badges
 * and tags, so it follows the description as the user edits it. */
export function matchCapturePatterns(text: string): CapturePattern[] {
  if (!text) return [];
  return CAPTURE_PATTERNS.filter((p) => p.re.test(text));
}

/** Safety cap: a recognized link can be embedded in a wall of text (a whole
 * copied thread), and that still shouldn't flood the form unasked. */
export const AUTO_PASTE_MAX_CHARS = 500;

/** True when the clipboard is worth dropping into the description without
 * asking — it carries a known link and is small enough to eyeball. */
export function shouldAutoPaste(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > AUTO_PASTE_MAX_CHARS) return false;
  return matchCapturePatterns(trimmed).length > 0;
}
