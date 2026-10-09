/**
 * Arrangement of the top-bar tabs (T-0684): which are shown, in what order.
 *
 * The owner's choice is stored as two lists in the vault settings —
 * `tab_order` (every tab, hidden ones included) and `hidden_tabs`. Tab keys
 * come from code, so the lists are reconciled against the keys this build
 * knows rather than trusted: a stale key is dropped and a tab the lists have
 * never seen is appended. That is what lets a release add or remove a tab
 * without migrating anyone's settings.
 */

export interface TabLayout {
  /** Tabs in the strip, left to right. */
  visible: string[];
  /** Hidden tabs, in their stored order. */
  hidden: string[];
}

/** Reconciles the stored lists against the tabs this build has, in default order. */
export function resolveTabLayout(
  all: readonly string[],
  order: readonly string[],
  hidden: readonly string[],
): TabLayout {
  const known = new Set(all);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of [...order, ...all]) {
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  const hide = new Set(hidden);
  const visible = ordered.filter((k) => !hide.has(k));
  // Never leave the bar empty: a settings file edited by hand (or a sync of
  // two PCs that disagree) must not strand the owner with no tabs.
  if (visible.length === 0) return { visible: [...ordered], hidden: [] };
  return { visible, hidden: ordered.filter((k) => hide.has(k)) };
}

/** What gets stored for a layout: visible tabs first, then the hidden ones. */
export function toStored(layout: TabLayout): { tab_order: string[]; hidden_tabs: string[] } {
  return { tab_order: [...layout.visible, ...layout.hidden], hidden_tabs: [...layout.hidden] };
}

/** Moves `key` to the position of `over` within the visible tabs. */
export function reorderVisible(layout: TabLayout, key: string, over: string): TabLayout {
  const from = layout.visible.indexOf(key);
  const to = layout.visible.indexOf(over);
  if (from < 0 || to < 0 || from === to) return layout;
  const visible = [...layout.visible];
  visible.splice(from, 1);
  visible.splice(to, 0, key);
  return { ...layout, visible };
}

/** Hides a tab. The last visible tab cannot be hidden. */
export function hideTab(layout: TabLayout, key: string): TabLayout {
  if (!layout.visible.includes(key) || layout.visible.length <= 1) return layout;
  return {
    visible: layout.visible.filter((k) => k !== key),
    hidden: [...layout.hidden, key],
  };
}

/** Shows a hidden tab again, at the end of the strip. */
export function showTab(layout: TabLayout, key: string): TabLayout {
  if (!layout.hidden.includes(key)) return layout;
  return {
    visible: [...layout.visible, key],
    hidden: layout.hidden.filter((k) => k !== key),
  };
}
