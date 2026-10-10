import { describe, expect, it } from "vitest";
import {
  basename,
  dirOf,
  expandWikiEmbeds,
  expandWikiLinks,
  isExternalSrc,
  normalizeSlashPath,
  parseWikiHref,
  parseWikiLink,
  resolveDocLink,
  resolveDocRelative,
  splitFrontmatter,
  toWindowsPath,
  wikiHref,
} from "./markdown";

describe("expandWikiEmbeds", () => {
  it("rewrites an image embed into a CommonMark image", () => {
    expect(expandWikiEmbeds("see ![[diagram.png]] here")).toBe("see ![](<diagram.png>) here");
  });

  it("keeps the angle brackets so filenames with spaces still parse", () => {
    expect(expandWikiEmbeds("![[my screenshot.png]]")).toBe("![](<my screenshot.png>)");
  });

  it("uses the pipe as alt text, but not when it is Obsidian's width syntax", () => {
    expect(expandWikiEmbeds("![[a.png|the flow]]")).toBe("![the flow](<a.png>)");
    expect(expandWikiEmbeds("![[a.png|300]]")).toBe("![](<a.png>)");
    expect(expandWikiEmbeds("![[a.png|300x200]]")).toBe("![](<a.png>)");
  });

  it("resolves a subfolder reference and drops a heading anchor", () => {
    expect(expandWikiEmbeds("![[img/a.png]]")).toBe("![](<img/a.png>)");
    expect(expandWikiEmbeds("![[a.png#top]]")).toBe("![](<a.png>)");
  });

  it("leaves a document embed alone — only images are followed", () => {
    expect(expandWikiEmbeds("![[design notes]]")).toBe("![[design notes]]");
    expect(expandWikiEmbeds("![[spec.md]]")).toBe("![[spec.md]]");
  });

  it("leaves ordinary wiki links alone", () => {
    expect(expandWikiEmbeds("[[a.png]]")).toBe("[[a.png]]");
  });

  it("does not rewrite inside code spans or fenced blocks", () => {
    expect(expandWikiEmbeds("write `![[a.png]]` to embed")).toBe("write `![[a.png]]` to embed");
    const fenced = "before\n\n```md\n![[a.png]]\n```\n\nafter ![[b.png]]";
    expect(expandWikiEmbeds(fenced)).toBe("before\n\n```md\n![[a.png]]\n```\n\nafter ![](<b.png>)");
  });

  it("does not rewrite inside a fence that is never closed", () => {
    expect(expandWikiEmbeds("```\n![[a.png]]\n")).toBe("```\n![[a.png]]\n");
  });

  it("rewrites every embed in a document", () => {
    expect(expandWikiEmbeds("![[a.png]] and ![[b.jpg]]")).toBe("![](<a.png>) and ![](<b.jpg>)");
  });
});

describe("isExternalSrc", () => {
  it("recognizes what the browser should fetch itself", () => {
    expect(isExternalSrc("https://example.com/a.png")).toBe(true);
    expect(isExternalSrc("data:image/png;base64,AAAA")).toBe(true);
    expect(isExternalSrc("#section")).toBe(true);
  });

  it("treats a filesystem reference as ours to resolve", () => {
    expect(isExternalSrc("img/a.png")).toBe(false);
    expect(isExternalSrc("C:/share/a.png")).toBe(false);
  });
});

describe("resolveDocRelative", () => {
  const doc = "G:/shared drives/team/notes/design.md";

  it("resolves a sibling file against the document's folder", () => {
    expect(resolveDocRelative(doc, "a.png")).toBe("G:/shared drives/team/notes/a.png");
  });

  it("resolves ./ and ../ references", () => {
    expect(resolveDocRelative(doc, "./img/a.png")).toBe("G:/shared drives/team/notes/img/a.png");
    expect(resolveDocRelative(doc, "../assets/a.png")).toBe("G:/shared drives/team/assets/a.png");
  });

  it("decodes percent-encoded filenames back to what is on disk", () => {
    expect(resolveDocRelative(doc, "my%20image.png")).toBe(
      "G:/shared drives/team/notes/my image.png",
    );
  });

  it("survives a stray percent sign that is not an escape", () => {
    expect(resolveDocRelative(doc, "100%.png")).toBe("G:/shared drives/team/notes/100%.png");
  });

  it("strips the angle brackets the embed rewrite adds", () => {
    expect(resolveDocRelative(doc, "<a b.png>")).toBe("G:/shared drives/team/notes/a b.png");
  });

  it("passes an absolute reference through — the backend guard judges it", () => {
    expect(resolveDocRelative(doc, "//server/share/a.png")).toBe("//server/share/a.png");
    expect(resolveDocRelative(doc, "D:/other/a.png")).toBe("D:/other/a.png");
  });

  it("returns null for anything the backend must not be asked about", () => {
    expect(resolveDocRelative(doc, "https://example.com/a.png")).toBeNull();
    expect(resolveDocRelative(doc, "data:image/png;base64,AA")).toBeNull();
    expect(resolveDocRelative(doc, "   ")).toBeNull();
  });
});

describe("normalizeSlashPath", () => {
  it("keeps a drive, a UNC prefix and a rooted path intact", () => {
    expect(normalizeSlashPath("C:/a/./b")).toBe("C:/a/b");
    expect(normalizeSlashPath("//server/share/a/../b")).toBe("//server/share/b");
    expect(normalizeSlashPath("/a/b/../c")).toBe("/a/c");
  });

  it("never climbs past the root", () => {
    expect(normalizeSlashPath("C:/../../a")).toBe("C:/a");
  });
});

describe("dirOf", () => {
  it("returns the containing folder", () => {
    expect(dirOf("C:/a/b/c.md")).toBe("C:/a/b");
    expect(dirOf("C:\\a\\b\\c.md")).toBe("C:/a/b");
  });
});

describe("toWindowsPath", () => {
  it("writes drive and UNC paths with backslashes", () => {
    expect(toWindowsPath("C:/docs/a b/note.md")).toBe(String.raw`C:\docs\a b\note.md`);
    expect(toWindowsPath("//server/share/docs")).toBe(String.raw`\\server\share\docs`);
  });

  it("leaves anything else as it is", () => {
    expect(toWindowsPath("/home/me/docs")).toBe("/home/me/docs");
    expect(toWindowsPath("relative/a.md")).toBe("relative/a.md");
  });
});

describe("basename", () => {
  it("returns the file name from either slash style", () => {
    expect(basename("G:/share/notes/設計.md")).toBe("設計.md");
    expect(basename("//server/share/a.html")).toBe("a.html");
    expect(basename("C:\\docs\\b.md")).toBe("b.md");
  });

  it("ignores a trailing slash", () => {
    expect(basename("G:/share/folder/")).toBe("folder");
  });
});

describe("splitFrontmatter", () => {
  it("takes the block off the top and leaves the body alone", () => {
    const { frontmatter, body } = splitFrontmatter(
      "---\nid: B-007\ntitle: Mindmap\n---\n\n# Heading\n",
    );
    expect(frontmatter).toBe("id: B-007\ntitle: Mindmap");
    expect(body).toBe("\n# Heading\n");
  });

  it("survives CRLF, which is what a Windows share hands over", () => {
    const { frontmatter, body } = splitFrontmatter("---\r\nid: B-007\r\n---\r\nbody\r\n");
    expect(frontmatter).toBe("id: B-007");
    expect(body).toBe("body\r\n");
  });

  it("leaves a document without frontmatter untouched", () => {
    const text = "# Heading\n\n---\n\nmore\n";
    expect(splitFrontmatter(text)).toEqual({ frontmatter: "", body: text });
  });

  it("does not mistake a leading horizontal rule for a block", () => {
    // A rule and then prose, with no closing delimiter: nothing to take off.
    const text = "---\n\njust prose\n";
    expect(splitFrontmatter(text)).toEqual({ frontmatter: "", body: text });
  });

  it("stops at the first closing delimiter", () => {
    const { frontmatter, body } = splitFrontmatter("---\na: 1\n---\ntext\n---\nmore\n");
    expect(frontmatter).toBe("a: 1");
    expect(body).toBe("text\n---\nmore\n");
  });
});

describe("resolveDocLink", () => {  const doc = "G:/shared drives/team/notes/design.md";

  it("resolves a link with full-width bars and Japanese in the name", () => {
    expect(resolveDocLink(doc, "開発プロセス｜予実ベロシティ更新方法.md")).toBe(
      "G:/shared drives/team/notes/開発プロセス｜予実ベロシティ更新方法.md",
    );
  });

  it("decodes a percent-encoded name and drops a fragment", () => {
    expect(resolveDocLink(doc, "a%EF%BD%9Cb.md#sec")).toBe("G:/shared drives/team/notes/a｜b.md");
  });

  it("is null for the web, a bare fragment and other schemes", () => {
    expect(resolveDocLink(doc, "https://example.com/a.md")).toBeNull();
    expect(resolveDocLink(doc, "#top")).toBeNull();
    expect(resolveDocLink(doc, "mailto:a@b.c")).toBeNull();
  });
});

describe("parseWikiLink", () => {
  it("splits the target from an alias", () => {
    expect(parseWikiLink("B-051-thing")).toEqual({ target: "B-051-thing", label: "B-051-thing" });
    expect(parseWikiLink("B-051-thing|the spec")).toEqual({
      target: "B-051-thing",
      label: "the spec",
    });
  });

  it("drops a heading anchor from the target but keeps it in the label", () => {
    expect(parseWikiLink("notes#Results")).toEqual({ target: "notes", label: "notes#Results" });
    expect(parseWikiLink("notes#Results|outcomes")).toEqual({
      target: "notes",
      label: "outcomes",
    });
  });

  it("keeps a folder path as the target", () => {
    expect(parseWikiLink("backlog/B-051-x|item")).toEqual({
      target: "backlog/B-051-x",
      label: "item",
    });
  });

  it("rejects an empty link, a bare alias and a bare heading", () => {
    expect(parseWikiLink("")).toBeNull();
    expect(parseWikiLink("   ")).toBeNull();
    expect(parseWikiLink("|alias")).toBeNull();
    expect(parseWikiLink("#heading")).toBeNull();
  });
});

describe("wikiHref", () => {
  it("round-trips a target with spaces and slashes", () => {
    expect(parseWikiHref(wikiHref("backlog/B-051 my note"))).toBe("backlog/B-051 my note");
  });

  it("is null for ordinary links", () => {
    expect(parseWikiHref("notes/a.md")).toBeNull();
    expect(parseWikiHref("https://example.com")).toBeNull();
  });

  it("survives a stray percent sign that is not an escape", () => {
    expect(parseWikiHref("wiki:100%.md")).toBe("100%.md");
  });
});

describe("expandWikiLinks", () => {
  it("rewrites a bare link into a wiki: link", () => {
    expect(expandWikiLinks("see [[T-0715-20261010]] here")).toBe(
      "see [T-0715-20261010](<wiki:T-0715-20261010>) here",
    );
  });

  it("shows the alias and resolves the target", () => {
    expect(expandWikiLinks("[[B-051-thing|the spec]]")).toBe(
      "[the spec](<wiki:B-051-thing>)",
    );
  });

  it("drops a heading anchor from the destination but not the label", () => {
    expect(expandWikiLinks("[[notes#Results]]")).toBe("[notes#Results](<wiki:notes>)");
  });

  it("encodes spaces and keeps folder paths", () => {
    expect(expandWikiLinks("[[my folder/my note]]")).toContain("wiki:my%20folder/my%20note");
  });

  it("leaves image embeds to expandWikiEmbeds", () => {
    expect(expandWikiLinks("see ![[diagram.png]] here")).toBe("see ![[diagram.png]] here");
  });

  it("leaves a non-image embed alone — it is not a link", () => {
    expect(expandWikiLinks("![[design notes]]")).toBe("![[design notes]]");
  });

  it("does not rewrite inside code spans or fenced blocks", () => {
    expect(expandWikiLinks("write `[[a]]` to link")).toBe("write `[[a]]` to link");
    const fenced = "before\n\n```md\n[[a]]\n```\n\nafter [[b]]";
    expect(expandWikiLinks(fenced)).toBe(
      "before\n\n```md\n[[a]]\n```\n\nafter [b](<wiki:b>)",
    );
  });

  it("leaves an empty link alone", () => {
    expect(expandWikiLinks("[[]] and [[  ]]")).toBe("[[]] and [[  ]]");
  });

  it("rewrites every link in a document", () => {
    expect(expandWikiLinks("[[a]] and [[b|c]]")).toBe("[a](<wiki:a>) and [c](<wiki:b>)");
  });
});
