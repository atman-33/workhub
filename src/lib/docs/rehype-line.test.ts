import { describe, expect, it } from "vitest";
import type { Element, Root } from "hast";
import { splitFrontmatter } from "./markdown";
import { frontmatterOffset, rehypeLineNumbers } from "./rehype-line";

/** A hast element, with the position remark would have given it. */
function el(tagName: string, line: number | null, children: Element[] = []): Element {
  return {
    type: "element",
    tagName,
    properties: {},
    children,
    ...(line === null
      ? {}
      : {
          position: {
            start: { line, column: 1, offset: 0 },
            end: { line, column: 1, offset: 0 },
          },
        }),
  };
}

function root(...children: Element[]): Root {
  return { type: "root", children };
}

function lineOf(node: Element): unknown {
  return node.properties["data-line"];
}

describe("rehypeLineNumbers", () => {
  it("writes each block's own line", () => {
    const tree = root(el("p", 1), el("p", 3));
    rehypeLineNumbers()(tree);
    expect((tree.children as Element[]).map(lineOf)).toEqual(["1", "3"]);
  });

  it("marks the blocks text is selected inside, and nothing else", () => {
    const tree = root(el("h2", 1), el("li", 2), el("blockquote", 3), el("pre", 4), el("hr", 5));
    rehypeLineNumbers()(tree);
    const marked = (tree.children as Element[]).filter((n) => lineOf(n) !== undefined);
    expect(marked.map((n) => n.tagName)).toEqual(["h2", "li", "blockquote", "pre"]);
  });

  it("reaches blocks nested inside other elements", () => {
    const inner = el("p", 4);
    const tree = root(el("blockquote", 3, [inner]));
    rehypeLineNumbers()(tree);
    expect(lineOf(inner)).toBe("4");
  });

  it("shifts every line by the offset, so the numbers name the file", () => {
    const tree = root(el("p", 1));
    rehypeLineNumbers({ offset: 5 })(tree);
    expect(lineOf((tree.children as Element[])[0])).toBe("6");
  });

  it("invents nothing for a node with no position", () => {
    // What `rehypeCallouts` synthesizes, and what `rehype-raw` re-parses: no
    // line is a normal answer, and the note falls back to its quote.
    const tree = root(el("p", null));
    rehypeLineNumbers()(tree);
    expect((tree.children as Element[])[0].properties).toEqual({});
  });

  it("keeps the attributes a block already carries", () => {
    const tree = root(el("p", 2));
    (tree.children as Element[])[0].properties = { className: ["lead"] };
    rehypeLineNumbers()(tree);
    expect((tree.children as Element[])[0].properties).toEqual({
      className: ["lead"],
      "data-line": "2",
    });
  });
});

describe("frontmatterOffset", () => {
  it("counts the lines the frontmatter took", () => {
    const source = "---\ntitle: x\ntags: []\n---\nbody\n";
    const { body } = splitFrontmatter(source);
    expect(body).toBe("body\n");
    expect(frontmatterOffset(source, body)).toBe(4);
  });

  it("is zero for a document that has none", () => {
    const source = "just a body\n";
    expect(frontmatterOffset(source, splitFrontmatter(source).body)).toBe(0);
  });

  it("tells an empty frontmatter block from no block at all", () => {
    // Both leave `splitFrontmatter` returning "" for the frontmatter, which is
    // why the offset is measured from the two strings instead.
    const source = "---\n\n---\nbody\n";
    const { frontmatter, body } = splitFrontmatter(source);
    expect(frontmatter).toBe("");
    expect(frontmatterOffset(source, body)).toBe(3);
  });

  it("counts CRLF the same as LF", () => {
    const source = "---\r\ntitle: x\r\n---\r\nbody\r\n";
    expect(frontmatterOffset(source, splitFrontmatter(source).body)).toBe(3);
  });
});
