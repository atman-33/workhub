/**
 * Guards the unified AI-edit skill (T-0685).
 *
 * One `diagram-edit` skill edits every kind of diagram: it reads the note's
 * `type` and follows that kind's rule file, so the formats live in the rules
 * and not in the skill. "A fourth kind works with the same skill" is only true
 * while the skill still points at a rule for each kind, the rules still exist,
 * and the two retired per-kind skills are not left behind to compete with it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGRAM_KINDS } from "@/lib/diagram-kinds";

const root = process.cwd();
const skillPath = join(root, "plugins", "workhub", "skills", "diagram-edit", "SKILL.md");
const skill = readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");
const rulesDir = join(root, "vault-template", ".claude", "rules");

/** The rule file each kind is documented in. */
const RULE_OF: Record<(typeof DIAGRAM_KINDS)[number], string> = {
  schedule: "schedules.md",
  mindmap: "mindmaps.md",
  matrix2x2: "diagrams.md",
  flow: "diagrams.md",
  pfd: "diagrams.md",
  algorithm: "diagrams.md",
  usecase: "diagrams.md",
  architecture: "diagrams.md",
  ifdam: "diagrams.md",
};

describe("diagram-edit skill", () => {
  it("is named diagram-edit and takes a path and an instruction", () => {
    expect(skill).toMatch(/^name: diagram-edit$/m);
    expect(skill).toMatch(/^argument-hint: "<diagram-file-path> <instruction>"$/m);
  });

  it.each(DIAGRAM_KINDS)("has a rule for %s, and the skill points at it", (kind) => {
    const rule = RULE_OF[kind];
    expect(existsSync(join(rulesDir, rule))).toBe(true);
    expect(skill).toContain(`\`${rule}\``);
    expect(skill).toContain(kind);
  });

  it("keeps formats out of the skill: no node, item or step grammar of its own", () => {
    expect(skill).not.toMatch(/^- \[bar\]/m);
    expect(skill).not.toMatch(/\bI-001\b/);
    expect(skill).not.toMatch(/^## (Items|Steps|Lanes|Edges|Non-working)\b/m);
  });

  it("states the shared rules every kind needs", () => {
    expect(skill).toContain("`node:`");
    expect(skill).toContain("## Memo");
    expect(skill).toMatch(/ids are never changed or reused/i);
    expect(skill).toMatch(/updated:/);
    expect(skill).toMatch(/Do not invent an id prefix/);
  });

  it("replaces the per-kind skills, which are gone", () => {
    for (const old of ["schedule-edit", "mindmap-edit"]) {
      expect(existsSync(join(root, "plugins", "workhub", "skills", old))).toBe(false);
    }
  });

  it("leaves no reference to the retired skills in the vault rules", () => {
    for (const rule of new Set(Object.values(RULE_OF))) {
      const text = readFileSync(join(rulesDir, rule), "utf8");
      expect(text).not.toMatch(/schedule-edit|mindmap-edit/);
    }
  });
});
