import { describe, expect, it } from "vitest";
import { attrColorFor, attrValueColor, chipsOf, setAttr } from "./attrs";
import {
  attrKeys,
  attrValues,
  formatTags,
  isAttrKey,
  nodeHasAttr,
  parseMindmap,
  parseTags,
  serializeMindmap,
  type MindmapNode,
} from "./parse";

const note = (nodes: string, frontmatter = "") =>
  `---\ntype: mindmap\ntitle: ideas\ncreated: 2026-08-26\nupdated: 2026-08-26\n${frontmatter}---\n\n` +
  `## Nodes\n\n${nodes}\n\n## Memo\n\nhuman prose\n`;

const roots = (lines: string[]) => parseMindmap(note(lines.join("\n"))).roots;

describe("attribute grammar", () => {
  it("reads key:value tokens off a node line", () => {
    const [root] = roots(["- N-001 auth prio:high size:L tags:検討中,要調査 #blue task:T-0042"]);
    expect(root.title).toBe("auth");
    expect(root.color).toBe("blue");
    expect(root.task).toBe("T-0042");
    expect(root.attrs).toEqual({ prio: "high", size: "L", tags: "検討中,要調査" });
  });

  it("leaves things that only look like attributes in the title", () => {
    const [root] = roots(["- N-001 定例 15:00 https://example.com Q3:目標 empty:"]);
    // A time, a URL, an uppercase key and a valueless key are all title text —
    // eating any of them would silently reorder the user's words on save.
    expect(root.attrs).toBeUndefined();
    expect(root.title).toBe("定例 15:00 https://example.com Q3:目標 empty:");
  });

  it("round-trips attributes, sorted and after the reserved fields", () => {
    const src = note("- N-001 auth size:L prio:high #blue task:T-0042 ^collapsed");
    const doc = parseMindmap(src);
    const out = serializeMindmap(src, doc, "2026-09-02");
    expect(out).toContain("- N-001 auth #blue task:T-0042 prio:high size:L ^collapsed");
  });

  it("keeps a key it does not know about", () => {
    const src = note("- N-001 auth owner:me whatever:x");
    const doc = parseMindmap(src);
    expect(serializeMindmap(src, doc, "2026-09-02")).toContain("owner:me whatever:x");
  });

  it("drops an attribute whose value has been emptied", () => {
    const src = note("- N-001 auth prio:high");
    const doc = parseMindmap(src);
    doc.roots[0].attrs = { prio: "" };
    expect(serializeMindmap(src, doc, "2026-09-02")).toContain("- N-001 auth\n");
  });

  it("accepts only keys it can read back", () => {
    expect(isAttrKey("prio")).toBe(true);
    expect(isAttrKey("due-by_2")).toBe(true);
    expect(isAttrKey("Prio")).toBe(false);
    expect(isAttrKey("2nd")).toBe(false);
    expect(isAttrKey("優先度")).toBe(false);
  });
});

describe("tags", () => {
  it("splits and joins a comma-separated value", () => {
    expect(parseTags("a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(formatTags(["a", " b "])).toBe("a,b");
    expect(formatTags([])).toBe("");
  });

  it("matches a tag by membership and everything else by equality", () => {
    const node = { attrs: { tags: "a,b", prio: "high" } } as unknown as MindmapNode;
    expect(nodeHasAttr(node, "tags", "b")).toBe(true);
    expect(nodeHasAttr(node, "tags", "c")).toBe(false);
    expect(nodeHasAttr(node, "prio", "high")).toBe(true);
    expect(nodeHasAttr(node, "prio", "hig")).toBe(false);
  });
});

describe("the map's own vocabulary", () => {
  it("collects the keys and values actually used", () => {
    const tree = roots(["- N-001 a prio:high tags:x,y", "  - N-002 b prio:low tags:y"]);
    expect(attrKeys(tree)).toEqual(["prio", "tags"]);
    expect(attrValues(tree, "prio")).toEqual(["high", "low"]);
    // Tags are offered one at a time, not as the joined attribute value.
    expect(attrValues(tree, "tags")).toEqual(["x", "y"]);
  });
});

describe("chips", () => {
  it("labels a tag as itself and everything else as key: value", () => {
    const [root] = roots(["- N-001 a prio:high tags:x,y"]);
    expect(chipsOf(root, "all").map((c) => c.label)).toEqual(["prio: high", "x", "y"]);
  });

  it("narrows to the listed keys, and shows nothing for an empty list", () => {
    const [root] = roots(["- N-001 a prio:high tags:x"]);
    expect(chipsOf(root, ["prio"]).map((c) => c.label)).toEqual(["prio: high"]);
    expect(chipsOf(root, [])).toEqual([]);
  });

  it("gives one value the same colour every time", () => {
    expect(attrValueColor("high")).toBe(attrValueColor("high"));
    const [root] = roots(["- N-001 a prio:high"]);
    expect(attrColorFor(root, "prio")).toBe(attrValueColor("high"));
    expect(attrColorFor(root, "size")).toBeUndefined();
  });
});

describe("setAttr", () => {
  it("sets, clears, and drops the map when the last key goes", () => {
    expect(setAttr(undefined, "prio", "high")).toEqual({ prio: "high" });
    expect(setAttr({ prio: "high", size: "L" }, "prio", "")).toEqual({ size: "L" });
    expect(setAttr({ prio: "high" }, "prio", "")).toBeUndefined();
  });
});

describe("the attribute view in the frontmatter", () => {
  it("defaults to chips on, no colouring and no filter", () => {
    const doc = parseMindmap(note("- N-001 a prio:high"));
    expect(doc.attrView).toEqual({ chips: "all", color: "", filter: null });
  });

  it("reads the three settings", () => {
    const doc = parseMindmap(
      note("- N-001 a prio:high", "attr_chips: prio,tags\nattr_color: prio\nattr_filter: prio=high\n"),
    );
    expect(doc.attrView).toEqual({
      chips: ["prio", "tags"],
      color: "prio",
      filter: { key: "prio", value: "high" },
    });
  });

  it("writes a default as the absence of the key", () => {
    const src = note("- N-001 a prio:high", "attr_color: prio\n");
    const doc = parseMindmap(src);
    doc.attrView = { chips: "all", color: "", filter: null };
    const out = serializeMindmap(src, doc, "2026-09-02");
    expect(out).not.toContain("attr_color");
    expect(out).not.toContain("attr_chips");
  });

  it("writes chips-off as `none`, which reads back as an empty list", () => {
    const src = note("- N-001 a prio:high");
    const doc = parseMindmap(src);
    doc.attrView = { ...doc.attrView, chips: [] };
    const out = serializeMindmap(src, doc, "2026-09-02");
    expect(out).toContain("attr_chips: none");
    expect(parseMindmap(out).attrView.chips).toEqual([]);
  });
});
