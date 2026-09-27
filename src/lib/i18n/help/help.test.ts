import { describe, expect, it } from "vitest";
import { helpEn } from "./help.en";
import { helpJa } from "./help.ja";
import { HELP_SECTION_IDS } from "./types";
import { helpSectionMarkdown, helpSections } from "./index";

/** The shape of a section's Markdown: its list items, numbered steps and
 * fenced blocks. A translation keeps these one-for-one with the English. */
function shape(body: string) {
  const lines = body.split("\n");
  return {
    bullets: lines.filter((l) => l.startsWith("- ")).length,
    steps: lines.filter((l) => /^\d+\. /.test(l)).length,
    fences: lines.filter((l) => l.startsWith("```")).length,
  };
}

describe("help sections", () => {
  it.each(HELP_SECTION_IDS)("%s has the same shape in English and Japanese", (id) => {
    expect(shape(helpJa[id].body)).toEqual(shape(helpEn[id].body));
  });

  it.each(HELP_SECTION_IDS)("%s keeps the English code blocks verbatim", (id) => {
    const fenced = (body: string) => body.match(/^```[^\n]*\n[\s\S]*?\n```$/gm) ?? [];
    expect(fenced(helpJa[id].body)).toEqual(fenced(helpEn[id].body));
  });

  it("lists every section in display order for each locale", () => {
    expect(helpSections("en").map((s) => s.id)).toEqual([...HELP_SECTION_IDS]);
    expect(helpSections("ja").map((s) => s.id)).toEqual([...HELP_SECTION_IDS]);
    expect(helpSections("ja")[0].title).toBe(helpJa.setup.title);
  });

  it("copies a section as Markdown with its title as the heading", () => {
    expect(helpSectionMarkdown(helpEn.zoom)).toBe(`## App zoom\n\n${helpEn.zoom.body}`);
  });
});
