// @vitest-environment happy-dom
// Ranges and TreeWalkers: this module is nothing but DOM.
import { describe, expect, it } from "vitest";
import { captureAnchor, findRange } from "./annotation-range";

/** Builds a document body and hands back the element to annotate. */
function render(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root") as HTMLElement;
}

/** A range over `[start, end)` of one text node's data. */
function over(node: Node, start: number, end: number): Range {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

function firstText(el: Element): Text {
  return el.firstChild as Text;
}

describe("captureAnchor", () => {
  it("records the selected text and the line of the block it is in", () => {
    const root = render('<p data-line="7">Shorten this sentence.</p>');
    const text = firstText(root.querySelector("p") as Element);
    const anchor = captureAnchor(root, over(text, 0, 7));
    expect(anchor).toEqual({ quote: "Shorten", occurrence: 0, line: 7 });
  });

  it("has no line when nothing on the way up carries one", () => {
    const root = render("<p>Shorten this sentence.</p>");
    const text = firstText(root.querySelector("p") as Element);
    expect(captureAnchor(root, over(text, 0, 7))?.line).toBeUndefined();
  });

  it("takes the line from the nearest block, not the outermost", () => {
    const root = render(
      '<blockquote data-line="3"><p data-line="4">inner text</p></blockquote>',
    );
    const text = firstText(root.querySelector("p") as Element);
    expect(captureAnchor(root, over(text, 0, 5))?.line).toBe(4);
  });

  it("counts which occurrence of a repeated phrase was selected", () => {
    const root = render('<p data-line="1">TODO</p><p data-line="2">TODO</p><p data-line="3">TODO</p>');
    const third = root.querySelectorAll("p")[2];
    const anchor = captureAnchor(root, over(firstText(third), 0, 4));
    expect(anchor).toEqual({ quote: "TODO", occurrence: 2, line: 3 });
  });

  it("refuses a collapsed or whitespace-only selection", () => {
    const root = render('<p data-line="1">  text  </p>');
    const text = firstText(root.querySelector("p") as Element);
    expect(captureAnchor(root, over(text, 2, 2))).toBeNull();
    expect(captureAnchor(root, over(text, 0, 2))).toBeNull();
  });

  it("ignores a stylesheet's text, so a page with one still counts correctly", () => {
    const root = render('<style>p { content: "TODO"; }</style><p data-line="2">TODO</p>');
    const anchor = captureAnchor(root, over(firstText(root.querySelector("p") as Element), 0, 4));
    expect(anchor?.occurrence).toBe(0);
  });
});

describe("findRange", () => {
  it("comes back to the passage the anchor was taken from", () => {
    const root = render('<p data-line="1">first</p><p data-line="2">second</p>');
    const range = findRange(root, { quote: "second", occurrence: 0 });
    expect(range?.toString()).toBe("second");
    expect(range?.startContainer.parentElement?.getAttribute("data-line")).toBe("2");
  });

  it("picks the recorded occurrence of a repeated phrase", () => {
    const root = render("<p>TODO</p><p>TODO</p><p>TODO</p>");
    const range = findRange(root, { quote: "TODO", occurrence: 2 });
    expect(range?.startContainer).toBe(firstText(root.querySelectorAll("p")[2]));
  });

  it("falls back to the first occurrence when the recorded one has gone", () => {
    const root = render("<p>TODO</p>");
    const range = findRange(root, { quote: "TODO", occurrence: 4 });
    expect(range?.startContainer).toBe(firstText(root.querySelector("p") as Element));
  });

  it("gives up when the text itself is gone — the case the list has to show", () => {
    const root = render("<p>rewritten entirely</p>");
    expect(findRange(root, { quote: "the old wording", occurrence: 0 })).toBeNull();
  });

  it("spans inline markup, so a selection across a link still resolves", () => {
    const root = render('<p data-line="1">see <a href="#x">the docs</a> for more</p>');
    const range = findRange(root, { quote: "the docs for", occurrence: 0 });
    expect(range?.toString()).toBe("the docs for");
  });

  it("survives a re-render: the same anchor resolves in a fresh tree", () => {
    const first = render('<p data-line="1">keep this</p>');
    const anchor = captureAnchor(first, over(firstText(first.querySelector("p") as Element), 0, 9));
    const second = render('<p data-line="1">added above</p><p data-line="2">keep this</p>');
    expect(anchor && findRange(second, anchor)?.toString()).toBe("keep this");
  });
});
