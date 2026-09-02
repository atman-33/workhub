import { describe, expect, it } from "vitest";
import {
  attrColorFor,
  attrValueColor,
  chipCommand,
  chipsOf,
  quickAttrGroups,
  quickAttrToggle,
  setAttr,
  type AttrChip,
} from "./attrs";
import {
  attrKeys,
  attrValues,
  formatTags,
  isAttrKey,
  nodeHasAttr,
  parseMindmap,
  parseTags,
  serializeMindmap,
  type AttrView,
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

  it("draws the listed keys in the order they are listed", () => {
    const [root] = roots(["- N-001 a prio:high size:L tags:x"]);
    // Alphabetical is only the fallback — `tags` sorts last by accident of
    // spelling, which is the whole reason the order is settable.
    expect(chipsOf(root, "all").map((c) => c.label)).toEqual(["prio: high", "size: L", "x"]);
    expect(chipsOf(root, ["tags", "prio", "size"]).map((c) => c.label)).toEqual([
      "x",
      "prio: high",
      "size: L",
    ]);
  });

  it("skips a listed key the node does not carry", () => {
    const [root] = roots(["- N-001 a prio:high"]);
    expect(chipsOf(root, ["tags", "prio"]).map((c) => c.label)).toEqual(["prio: high"]);
  });

  it("keeps a node's tags in the order they were written", () => {
    const [root] = roots(["- N-001 a tags:zulu,alpha,mike"]);
    expect(chipsOf(root, "all").map((c) => c.label)).toEqual(["zulu", "alpha", "mike"]);
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

describe("chip menu commands", () => {
  const view = (patch: Partial<AttrView> = {}): AttrView => ({
    chips: "all",
    color: "",
    filter: null,
    ...patch,
  });
  const chip = (key: string, value: string): AttrChip => ({
    key,
    value,
    label: value,
    color: attrValueColor(value),
  });

  it("filters by the chip, and clears the filter again", () => {
    const ctx = { view: view(), keys: ["prio"], attrs: { prio: "high" } };
    expect(chipCommand("filter", chip("prio", "high"), ctx)).toEqual({
      kind: "view",
      patch: { filter: { key: "prio", value: "high" } },
    });
    expect(chipCommand("clearFilter", chip("prio", "high"), ctx)).toEqual({
      kind: "view",
      patch: { filter: null },
    });
  });

  it("colours by the key, and the same item turns colouring off", () => {
    const ctx = { view: view(), keys: ["prio"], attrs: { prio: "high" } };
    expect(chipCommand("colorBy", chip("prio", "high"), ctx)).toEqual({
      kind: "view",
      patch: { color: "prio" },
    });
    const coloured = { ...ctx, view: view({ color: "prio" }) };
    expect(chipCommand("colorBy", chip("prio", "high"), coloured)).toEqual({
      kind: "view",
      patch: { color: "" },
    });
  });

  it("spells `all` out into the key list before hiding one key", () => {
    const ctx = { view: view(), keys: ["prio", "size", "tags"], attrs: { prio: "high" } };
    expect(chipCommand("hideKey", chip("size", "L"), ctx)).toEqual({
      kind: "view",
      patch: { chips: ["prio", "tags"] },
    });
  });

  it("hides a key out of an existing list without disturbing its order", () => {
    const ctx = {
      view: view({ chips: ["tags", "prio", "size"] }),
      keys: ["prio", "size", "tags"],
      attrs: { prio: "high" },
    };
    expect(chipCommand("hideKey", chip("prio", "high"), ctx)).toEqual({
      kind: "view",
      patch: { chips: ["tags", "size"] },
    });
  });

  it("removes one tag from the list but a plain attribute whole", () => {
    const attrs = { tags: "a,b,c", prio: "high" };
    const ctx = { view: view(), keys: ["prio", "tags"], attrs };
    expect(chipCommand("remove", chip("tags", "b"), ctx)).toEqual({
      kind: "attrs",
      attrs: { tags: "a,c", prio: "high" },
    });
    expect(chipCommand("remove", chip("prio", "high"), ctx)).toEqual({
      kind: "attrs",
      attrs: { tags: "a,b,c" },
    });
  });

  it("drops the attribute map when the last chip goes", () => {
    const ctx = { view: view(), keys: ["tags"], attrs: { tags: "only" } };
    expect(chipCommand("remove", chip("tags", "only"), ctx)).toEqual({
      kind: "attrs",
      attrs: undefined,
    });
  });
});

describe("quickAttrGroups", () => {
  const vocab = [
    { key: "prio", values: ["high", "low"] },
    { key: "tags", values: ["draft", "review"] },
  ];

  it("marks the values the node already carries", () => {
    const groups = quickAttrGroups(vocab, { prio: "high", tags: "review" });
    expect(groups.map((g) => g.key)).toEqual(["prio", "tags"]);
    expect(groups[0].options).toEqual([
      { value: "high", label: "prio: high", on: true },
      { value: "low", label: "prio: low", on: false },
    ]);
    // A tag reads as itself; the key would be the same word on every item.
    expect(groups[1].options.map((o) => [o.label, o.on])).toEqual([
      ["draft", false],
      ["review", true],
    ]);
  });

  it("skips a key with no values", () => {
    expect(quickAttrGroups([{ key: "prio", values: [] }], undefined)).toEqual([]);
  });

  it("caps a long list but never cuts a value that is on", () => {
    const values = ["a", "b", "c", "d", "e"];
    const groups = quickAttrGroups([{ key: "tags", values }], { tags: "e" }, 2);
    // `e` is kept because it is on; the cap then leaves room for one more.
    expect(groups[0].options.map((o) => o.value)).toEqual(["a", "e"]);
    expect(groups[0].overflow).toBe(3);
  });

  it("keeps the vocabulary's order rather than floating the checked ones", () => {
    const groups = quickAttrGroups([{ key: "tags", values: ["a", "b", "c"] }], { tags: "c" });
    expect(groups[0].options.map((o) => o.value)).toEqual(["a", "b", "c"]);
    expect(groups[0].overflow).toBe(0);
  });
});

describe("quickAttrToggle", () => {
  it("adds and removes a tag", () => {
    expect(quickAttrToggle({ tags: "a" }, "tags", "b")).toEqual({ tags: "a,b" });
    expect(quickAttrToggle({ tags: "a,b" }, "tags", "a")).toEqual({ tags: "b" });
  });

  it("replaces a single-valued key rather than accumulating", () => {
    expect(quickAttrToggle({ prio: "low" }, "prio", "high")).toEqual({ prio: "high" });
  });

  it("clears a single-valued key when the same value is chosen again", () => {
    expect(quickAttrToggle({ prio: "high", tags: "a" }, "prio", "high")).toEqual({ tags: "a" });
  });

  it("drops the attribute map when the last value goes", () => {
    expect(quickAttrToggle({ tags: "only" }, "tags", "only")).toBeUndefined();
    expect(quickAttrToggle(undefined, "prio", "high")).toEqual({ prio: "high" });
  });
});
