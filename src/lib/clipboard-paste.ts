/** Auto-paste guard for the quick-capture window: short clipboard content
 * (Slack links, one-liners) is pasted into the description automatically;
 * anything past these limits waits behind an explicit paste button so a
 * wall of text never floods the form. */
export const AUTO_PASTE_MAX_CHARS = 500;
export const AUTO_PASTE_MAX_LINES = 10;

export function shouldAutoPaste(text: string): boolean {
  if (!text) return false;
  return (
    text.length <= AUTO_PASTE_MAX_CHARS &&
    text.split("\n").length <= AUTO_PASTE_MAX_LINES
  );
}
