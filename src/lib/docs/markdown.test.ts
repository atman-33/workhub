import { describe, expect, it } from "vitest";
import {
  basename,
  dirOf,
  expandWikiEmbeds,
  isExternalSrc,
  normalizeSlashPath,
  resolveDocRelative,
  splitFrontmatter,
  toWindowsPath,
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
