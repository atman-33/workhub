/**
 * The Help tab's sections (T-0428).
 *
 * The order here is the order on screen, in the contents row, and in "Copy
 * all". Adding a section means adding its id here and its text to both
 * `help.en.ts` and `help.ja.ts` — the `HelpSections` type makes a missing
 * language a compile error rather than a section that silently stays English.
 */
export const HELP_SECTION_IDS = [
  "setup",
  "zoom",
  "tabs",
  "template",
  "memory",
  "secretary",
  "custom-prompt",
  "claude-desktop",
  "ink",
  "quick-capture",
  "voice",
  "clips",
  "projects",
  "diagrams",
  "schedule",
  "mindmap",
  "docs",
  "inbox",
  "persona",
  "plugins",
  "tidy",
  "recurring",
  "diagnostic-log",
] as const;

export type HelpSectionId = (typeof HELP_SECTION_IDS)[number];

export interface HelpSection {
  /** The label on the contents row. */
  short: string;
  /** The accordion heading, and the `##` heading of the copied Markdown. */
  title: string;
  /** Markdown, rendered in the tab and copied as-is. */
  body: string;
}

export type HelpSections = Record<HelpSectionId, HelpSection>;
