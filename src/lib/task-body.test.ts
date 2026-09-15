import { describe, expect, it } from "vitest";
import { buildBody, DEFAULT_BODY, parseBody } from "./task-body";

describe("parseBody / buildBody", () => {
  it("parses the default (empty) template body as three empty sections", () => {
    const parsed = parseBody(DEFAULT_BODY);
    expect(parsed.hasSections).toBe(true);
    expect(parsed.content).toBe("");
    expect(parsed.plan).toBe("");
    expect(parsed.planRaw).toBe("## Plan\n\n");
    // buildBody's blank-line spacing on an empty section is a pre-existing
    // quirk (unrelated to Plan support) — assert only that no bytes are
    // dropped and the Plan header is preserved, not exact spacing.
    const rebuilt = buildBody(parsed, parsed.content);
    expect(rebuilt).toContain("## Plan");
    expect(parseBody(rebuilt).content).toBe("");
    expect(parseBody(rebuilt).plan).toBe("");
  });

  it("an old 2-section file survives an edit unchanged and gains no Plan header", () => {
    const body =
      "\n## Description\n\nSome hand-written prose.\nLine two.\n\n## Results\n\n- [[some note]]\n";
    const parsed = parseBody(body);
    expect(parsed.hasSections).toBe(true);
    expect(parsed.content).toBe("Some hand-written prose.\nLine two.");
    expect(parsed.plan).toBe("");
    expect(parsed.planRaw).toBe("");

    // An edit that doesn't touch the description text must reproduce the
    // original bytes exactly — no "## Plan" header appears anywhere.
    const rebuilt = buildBody(parsed, parsed.content);
    expect(rebuilt).toBe(body);
    expect(rebuilt).not.toContain("## Plan");
  });

  it("a 3-section file survives an edit with Plan preserved byte-for-byte", () => {
    const body =
      "\n## Description\n\nDo the thing.\n\n## Plan\n\nStep 1.\nStep 2.\n\n## Results\n\n- done\n";
    const parsed = parseBody(body);
    expect(parsed.hasSections).toBe(true);
    expect(parsed.content).toBe("Do the thing.");
    expect(parsed.plan).toBe("Step 1.\nStep 2.");
    expect(parsed.planRaw).toBe("## Plan\n\nStep 1.\nStep 2.\n\n");

    // Editing only the description must leave Plan byte-for-byte identical.
    const rebuilt = buildBody(parsed, "Do the updated thing.");
    expect(rebuilt).toBe(
      "\n## Description\n\nDo the updated thing.\n\n## Plan\n\nStep 1.\nStep 2.\n\n## Results\n\n- done\n",
    );

    // An untouched edit round-trips the whole body exactly.
    expect(buildBody(parsed, parsed.content)).toBe(body);
  });

  it("does not mis-split on a mermaid fence or code block containing header-looking text", () => {
    const body = [
      "",
      "## Description",
      "",
      "Do the thing.",
      "",
      "## Plan",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "  B --> C",
      "```",
      "",
      "Some notes referencing a fake header inside a code block:",
      "",
      "```",
      "## Results",
      "This is not the real Results section.",
      "```",
      "",
      "## Results",
      "",
      "- the real results",
      "",
    ].join("\n");

    const parsed = parseBody(body);
    expect(parsed.hasSections).toBe(true);
    expect(parsed.content).toBe("Do the thing.");
    expect(parsed.plan).toContain("```mermaid");
    expect(parsed.plan).toContain("This is not the real Results section.");
    expect(parsed.resultRaw.startsWith("## Results")).toBe(true);
    expect(parsed.resultRaw).toContain("- the real results");
    expect(parsed.resultRaw).not.toContain("fake header");

    // Round-trips exactly when the description is left untouched.
    expect(buildBody(parsed, parsed.content)).toBe(body);
  });

  it("treats an unrecognized body (no headers) as unstructured and appends a Description section", () => {
    const body = "Just some raw legacy content with no headers.\n";
    const parsed = parseBody(body);
    expect(parsed.hasSections).toBe(false);
    expect(parsed.plan).toBe("");

    const rebuilt = buildBody(parsed, "New description text.");
    expect(rebuilt).toBe(
      "Just some raw legacy content with no headers.\n\n## Description\n\nNew description text.\n",
    );
  });

  it("parses a Description-only body and round-trips it byte-for-byte", () => {
    const body = "\n## Description\n\nSome fresh task text.\nLine two.\n";
    const parsed = parseBody(body);
    expect(parsed.hasSections).toBe(true);
    expect(parsed.content).toBe("Some fresh task text.\nLine two.");
    expect(parsed.plan).toBe("");
    expect(parsed.planRaw).toBe("");
    expect(parsed.resultRaw).toBe("");

    // An untouched edit reproduces the original bytes exactly.
    expect(buildBody(parsed, parsed.content)).toBe(body);
  });

  it("parses Description + Plan without Results and preserves the plan", () => {
    const body = "\n## Description\n\nDo the thing.\n\n## Plan\n\nStep 1.\nStep 2.\n";
    const parsed = parseBody(body);
    expect(parsed.hasSections).toBe(true);
    expect(parsed.content).toBe("Do the thing.");
    expect(parsed.plan).toBe("Step 1.\nStep 2.");
    expect(parsed.planRaw).toBe("## Plan\n\nStep 1.\nStep 2.\n");
    expect(parsed.resultRaw).toBe("");

    // An untouched edit round-trips exactly; editing the description keeps
    // the plan byte-for-byte and invents no Results header.
    expect(buildBody(parsed, parsed.content)).toBe(body);
    expect(buildBody(parsed, "Do the updated thing.")).toBe(
      "\n## Description\n\nDo the updated thing.\n\n## Plan\n\nStep 1.\nStep 2.\n",
    );
  });

  it("never duplicates Description-only text on save and invents no Results header", () => {
    const body = "\n## Description\n\nSome fresh task text.\n";
    const parsed = parseBody(body);
    expect(parsed.hasSections).toBe(true);

    const rebuilt = buildBody(parsed, "New description text.");
    expect(rebuilt).toBe("\n## Description\n\nNew description text.\n");
    // Exactly one Description header, no leftover original text, no Results.
    expect(rebuilt.match(/## Description/g)).toHaveLength(1);
    expect(rebuilt).not.toContain("Some fresh task text.");
    expect(rebuilt).not.toContain("## Results");
    expect(rebuilt).not.toContain("## Plan");
  });

  it("preserves a trailing space after a list marker so the next sync does not rewrite the editor (T-0357)", () => {
    const body = "\n## Description\n\n- aaa\n- \n\n## Results\n\n- done\n";
    const parsed = parseBody(body);
    expect(parsed.content).toBe("- aaa\n- ");

    // What the editor writes on autosave must read back identically —
    // otherwise the vault sync replaces the Textarea value mid-typing and
    // the cursor jumps.
    const rebuilt = buildBody(parsed, parsed.content);
    expect(rebuilt).toBe(body);
    expect(parseBody(rebuilt).content).toBe("- aaa\n- ");
  });

  it("preserves a spaces-only final line instead of deleting it (T-0357)", () => {
    const body = "\n## Description\n\n- 月曜\n- \n";
    const parsed = parseBody(body);
    expect(parsed.content).toBe("- 月曜\n- ");

    const rebuilt = buildBody(parsed, parsed.content);
    expect(rebuilt).toBe(body);
    expect(parseBody(rebuilt).content).toBe("- 月曜\n- ");
  });
});
