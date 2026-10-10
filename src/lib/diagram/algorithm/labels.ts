/**
 * The labels the editor offers as buttons on an arrow (T-0699). The label is
 * never filled in on its own: the file holds a language-free string, so the
 * writer chooses, and pressing a button writes exactly the text it shows.
 */
import type { Locale } from "../../i18n";

export const EDGE_LABEL_CANDIDATES: Record<Locale, readonly string[]> = {
  ja: ["はい", "いいえ"],
  en: ["Yes", "No"],
};

/** Whether `label` is one of the offered texts, in any language. */
export function isCandidateLabel(label: string | undefined): boolean {
  if (!label) return false;
  const text = label.trim();
  return Object.values(EDGE_LABEL_CANDIDATES).some((list) => list.includes(text));
}
