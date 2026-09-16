/**
 * The note format and its types (T-0368).
 *
 * The properties worth pinning are the ones that decide whether the owner can
 * still write a note by hand: what counts as an observation, what counts as a
 * link, and that a type never rejects anything. The field lists themselves are
 * not pinned — they are meant to change.
 */
import { describe, expect, it } from "vitest";
import { observationsOf, parseFrontmatter, parseNote, relationsOf } from "./lib/note.mjs";
import { TYPES, templateFor, validateNote } from "./lib/schema.mjs";

const DECISION = `---
title: Rate limiting
type: decision
status: open
tags: [api, throughput]
aliases:
  - Throttling
---

# Rate limiting

Bursts at the window boundary were the whole problem, and [[Public API]] is
where it showed.

## Observations
- [decision] Token bucket over a fixed window #api #infra (per endpoint)
- [rationale] A fixed window lets a client send 2x the limit across a boundary
- [alternative] Fixed window
- [alternative] Leaky bucket
- [ ] not an observation
- [x] also not one
- [see the docs](https://example.com)

## Relations
- affects [[Public API]]
- supersedes [[Rate limiting v1]]
- [[Loose End]]
`;

describe("parseFrontmatter", () => {
  it("reads scalars, inline lists and block lists", () => {
    const { frontmatter } = parseFrontmatter(DECISION);
    expect(frontmatter.title).toBe("Rate limiting");
    expect(frontmatter.type).toBe("decision");
    expect(frontmatter.tags).toEqual(["api", "throughput"]);
    expect(frontmatter.aliases).toEqual(["Throttling"]);
  });

  it("treats a note without frontmatter as all body", () => {
    const { frontmatter, body } = parseFrontmatter("# Plain\n\ntext\n");
    expect(frontmatter).toEqual({});
    expect(body).toContain("# Plain");
  });

  it("does not turn an empty key into a list", () => {
    const { frontmatter } = parseFrontmatter("---\ndecided:\ntitle: x\n---\nbody\n");
    expect(frontmatter.decided).toBe("");
  });
});

describe("parseNote", () => {
  const note = parseNote(DECISION);

  it("reads categorized facts with their tags and context", () => {
    const decision = note.observations.find((o) => o.category === "decision");
    expect(decision.text).toBe("Token bucket over a fixed window");
    expect(decision.tags).toEqual(["api", "infra"]);
    expect(decision.context).toBe("per endpoint");
  });

  it("keeps a repeated category as separate facts", () => {
    expect(observationsOf(note, "alternative")).toEqual(["Fixed window", "Leaky bucket"]);
  });

  it("ignores task checkboxes and Markdown links", () => {
    // Both are ordinary Markdown a note is allowed to contain; reading them as
    // facts is how a store fills up with nonsense nobody wrote on purpose.
    const categories = note.observations.map((o) => o.category);
    expect(categories).not.toContain(" ");
    expect(categories).not.toContain("x");
    expect(categories).not.toContain("see the docs");
  });

  it("reads typed links, and gives an untyped one the weakest honest meaning", () => {
    expect(relationsOf(note, "affects")).toEqual(["Public API"]);
    expect(relationsOf(note, "supersedes")).toEqual(["Rate limiting v1"]);
    expect(relationsOf(note, "relates_to")).toEqual(["Loose End"]);
  });

  it("leaves a wiki-link in prose out of the relations", () => {
    // Only list items are edges. A link mid-sentence is a reference, and
    // promoting it would make every mention look like a deliberate connection.
    expect(note.relations.map((r) => r.target)).not.toContain("Public API's");
    expect(note.relations).toHaveLength(3);
  });
});

describe("validateNote", () => {
  it("passes a well-formed note", () => {
    const { type, findings } = validateNote(parseNote(DECISION));
    expect(type).toBe("decision");
    expect(findings).toEqual([]);
  });

  it("says an untyped note is invisible, not merely untidy", () => {
    const { type, findings } = validateNote(parseNote("---\ntitle: x\n---\n# x\n"));
    expect(type).toBeNull();
    expect(findings[0].message).toMatch(/structured recall/);
  });

  it("names the known types when one is not recognized", () => {
    const { findings } = validateNote(parseNote("---\ntitle: x\ntype: nonsense\n---\n# x\n"));
    expect(findings[0].message).toContain("decision");
  });

  it("reports a missing required field with the reason it is required", () => {
    const { findings } = validateNote(
      parseNote("---\ntitle: x\ntype: decision\nstatus: open\n---\n# x\n"),
    );
    const alternative = findings.find((f) => f.field === "alternative");
    expect(alternative.message).toMatch(/relitigating/);
  });

  it("asks an open decision for its reasoning, and a settled one for nothing", () => {
    // An open decision without its alternatives cannot be revisited, which is
    // the point of recording it. A settled one from months ago is a record —
    // warning that it lacks content which was never captured, and cannot now
    // be recovered, only teaches the reader to skim the report.
    const bare = (status) =>
      `---\ntitle: x\ntype: decision\nstatus: ${status}\n---\n# x\n- [decision] we went with A\n`;

    const open = validateNote(parseNote(bare("open"))).findings.map((f) => f.field);
    expect(open).toContain("rationale");
    expect(open).toContain("alternative");

    for (const settled of ["accepted", "superseded", "rejected"]) {
      expect(validateNote(parseNote(bare(settled))).findings, settled).toEqual([]);
    }
  });

  it("rejects a status outside the allowed set", () => {
    const { findings } = validateNote(
      parseNote("---\ntitle: x\ntype: decision\nstatus: maybe\n---\n# x\n"),
    );
    expect(findings.some((f) => f.field === "status")).toBe(true);
  });

  it("flags a single-valued field used twice", () => {
    const text = `---
title: x
type: decision
status: open
---
# x
- [decision] one
- [decision] two
- [rationale] because
- [alternative] the other one
`;
    const { findings } = validateNote(parseNote(text));
    expect(findings.find((f) => f.field === "decision").message).toMatch(/holds one/);
  });

  it("never objects to an observation or relation the type does not mention", () => {
    // The type describes a subset. A note that carries more is a richer note,
    // not a malformed one — and a memory that rejects writes stops being
    // written to.
    const text = `---
title: x
type: decision
status: open
---
# x
- [decision] one
- [rationale] because
- [alternative] the other one
- [mood] cautious
- [whatever] fine

- blocks [[Something Else]]
`;
    expect(validateNote(parseNote(text)).findings).toEqual([]);
  });

  it("only ever warns", () => {
    const { findings } = validateNote(parseNote("---\ntitle: x\ntype: decision\n---\n# x\n"));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.level === "warn")).toBe(true);
  });
});

describe("templateFor", () => {
  it("produces a note its own type accepts once filled in", () => {
    for (const type of Object.keys(TYPES)) {
      const filled = templateFor(type, "Example")
        .split("\n")
        .map((line) =>
          // Fill every blank field the template leaves, and drop the optional
          // markers — what is being checked is the shape, not the content.
          line
            .replace(/^(- \[[a-z_]+\] )\s*(#.*)?$/, "$1something")
            .replace(/\[…\]\]/, "[Target]]")
            .replace(/\s+# optional$/, "")
            .replace(/^(status: )$/, "$1open"),
        )
        .join("\n");
      const { findings } = validateNote(parseNote(filled));
      expect(findings, `${type}: ${JSON.stringify(findings)}`).toEqual([]);
    }
  });

  it("refuses a type it does not know", () => {
    expect(() => templateFor("nonsense")).toThrow(/unknown type/);
  });
});
