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

function renderCallouts(markdown: string): string {
  return renderToStaticMarkup(
    <Markdown variant="document" allowHtml callouts>
      {markdown}
    </Markdown>,
  );
}

describe("Markdown callouts", () => {
  it("draws an Obsidian callout with its type as the default title", () => {
    const out = renderCallouts("> [!warning]\n> Mind the **gap**.");
    expect(out).toContain('data-callout="warning"');
    expect(out).toContain("Warning");
    expect(out).toContain("<strong>gap</strong>");
    expect(out).not.toContain("<blockquote");
    expect(out).not.toContain("[!warning]");
  });

  it("uses a custom title and keeps the rest of the paragraph as body", () => {
    const out = renderCallouts("> [!tip] Faster *builds*\n> Use the cache.\n>\n> - one");
    expect(out).toMatch(/data-callout="tip"[\s\S]*Faster <em>builds<\/em>[\s\S]*Use the cache\./);
    expect(out).toContain("<li>one</li>");
    expect(out).not.toContain("Tip");
  });

  it("resolves aliases and draws unknown types as a note", () => {
    expect(renderCallouts("> [!FAQ]\n> x")).toContain('data-callout="question"');
    const unknown = renderCallouts("> [!custom] Title\n> x");
    expect(unknown).toContain('data-callout="note"');
  });

  it("starts a '-' callout folded and a '+' one open", () => {
    const folded = renderCallouts("> [!note]- Hidden\n> secret body");
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).not.toContain("secret body");
    const open = renderCallouts("> [!note]+ Shown\n> visible body");
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("visible body");
  });

  it("converts nested callouts", () => {
    const out = renderCallouts("> [!info] Outer\n> > [!bug] Inner\n> > deep");
    expect(out).toContain('data-callout="info"');
    expect(out).toContain('data-callout="bug"');
    expect(out).toContain("deep");
  });

  it("draws NotePM and Zenn blocks without a title line", () => {
    const notepm = renderCallouts(":::note alert\n\n危険な操作\n:::\n\nafter");
    expect(notepm).toContain('data-callout="danger"');
    expect(notepm).toContain("危険な操作");
    expect(notepm).not.toContain("Danger");
    expect(notepm).not.toContain(":::");
    expect(notepm).toMatch(/<\/div>\s*<p>after<\/p>/);
    const zenn = renderCallouts(":::message\nメモ\n:::");
    expect(zenn).toContain('data-callout="warning"');
    // The marker line's break must not open the body with an empty line.
    expect(zenn).toMatch(/<p>メモ<\/p>/);
  });

  it("still sanitizes HTML inside a callout, and a raw data-callout is not honoured", () => {
    const out = renderCallouts(
      '> [!note]\n> <img src="x.png" onerror="alert(1)">\n\n<div data-callout-type="danger">forged</div>',
    );
    expect(out).not.toContain("onerror");
    expect(out.match(/data-callout=/g)).toHaveLength(1);
  });

  it("leaves plain quotes and ::: text alone when callouts are off", () => {
    const out = renderToStaticMarkup(
      <Markdown allowHtml>{"> [!note]\n> x\n\n:::note info\ny\n:::"}</Markdown>,
    );
    expect(out).toContain("<blockquote>");
    expect(out).toContain("[!note]");
    expect(out).toContain(":::note info");
    expect(out).not.toContain("data-callout");
  });
});
