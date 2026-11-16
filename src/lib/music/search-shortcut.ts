/** The parts of a KeyboardEvent the search shortcut looks at. */
export interface SearchShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** True when the key press happened in a field the user is typing into, or in a dialog. */
function isTypingOrInDialog(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest(EDITABLE) !== null || target.closest("[role='dialog']") !== null;
}

/**
 * Whether a key press should open the track search: Ctrl/Cmd+F anywhere, or a
 * bare `/` unless the user is typing in a field (a `/` there is a character)
 * or is inside another dialog.
 */
export function isSearchShortcut(e: SearchShortcutEvent): boolean {
  if (e.isComposing) {
    return false;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    return e.key.toLowerCase() === "f";
  }
  if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    return !isTypingOrInDialog(e.target);
  }
  return false;
}
