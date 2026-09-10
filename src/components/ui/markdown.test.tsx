import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

function render(markdown: string, allowHtml = true): string {
  return renderToStaticMarkup(<Markdown allowHtml={allowHtml}>{markdown}</Markdown>);
}

describe("Markdown allowHtml", () => {
  it("renders the HTML a team's notes are written with", () => {
    const out = render(
      "<details><summary>More</summary>\n\nhidden **text**\n\n</details>\n\n" +
        'Press <kbd>Ctrl</kbd>+<kbd>K</kbd>, see<sup>1</sup>.\n\n<img src="a.png" width="300">',
    );
    expect(out).toContain("<details>");
    expect(out).toContain("<summary>More</summary>");
    expect(out).toContain("<strong>text</strong>");
    expect(out).toContain("<kbd>Ctrl</kbd>");
    expect(out).toContain("<sup>1</sup>");
    expect(out).toMatch(/<img[^>]*width="300"/);
  });

  it("strips scripts, event handlers and javascript: links", () => {
    const out = render(
      '<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(2)">\n\n' +
        '<a href="javascript:alert(3)">click</a>\n\n<iframe src="https://example.com"></iframe>\n\n' +
        '<div style="position:fixed">x</div>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("position:fixed");
  });

  it("still marks fences with their language, so mermaid is recognised", () => {
    expect(render("```mermaid\ngraph TD\n```")).toContain('class="language-mermaid"');
  });

  it("drops raw HTML entirely when not asked for — the task previews' behaviour", () => {
    const out = render("<details><summary>More</summary></details>", false);
    expect(out).not.toContain("<details>");
  });
});
