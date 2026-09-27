import type { Locale } from "@/lib/i18n";
import { helpEn } from "./help.en";
import { helpJa } from "./help.ja";
import { HELP_SECTION_IDS, type HelpSection, type HelpSectionId } from "./types";

export { HELP_SECTION_IDS, type HelpSection, type HelpSectionId } from "./types";

/** The Help tab's sections in `locale`, in display order. */
export function helpSections(locale: Locale): (HelpSection & { id: HelpSectionId })[] {
  const text = locale === "ja" ? helpJa : helpEn;
  return HELP_SECTION_IDS.map((id) => ({ id, ...text[id] }));
}

/** A section as the Markdown its copy button puts on the clipboard. */
export function helpSectionMarkdown(section: HelpSection): string {
  return `## ${section.title}\n\n${section.body}`;
}
