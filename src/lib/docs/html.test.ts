// @vitest-environment happy-dom
// happy-dom would otherwise fetch the external stylesheet a test declares.
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { describe, expect, it } from "vitest";
import { HTML_PREVIEW_CSP, prepareHtmlDocument, serializeHtmlDocument } from "./html";

const DOC = "//server/share/reports/run.html";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** Loaders backed by a fixed map of absolute path → content. */
function loaders(files: Record<string, string>) {
  const read = async (path: string) => {
    if (path in files) return files[path];
    throw new Error(`missing ${path}`);
  };
  return { readText: read, readImage: read };
}

describe("prepareHtmlDocument", () => {
  it("inlines a relative image as the data URI the backend returns", async () => {
    const doc = parse('<img src="img/a b.png" srcset="img/a@2x.png 2x">');
    await prepareHtmlDocument(doc, DOC, loaders({ "//server/share/reports/img/a b.png": "data:x" }));
    const img = doc.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("data:x");
    // srcset would let the browser pick an unrewritten candidate.
    expect(img.hasAttribute("srcset")).toBe(false);
  });

  it("resolves `..`, and ignores a cache-buster in the reference", async () => {
    const doc = parse('<img src="../shared/logo.svg?v=3">');
    await prepareHtmlDocument(doc, DOC, loaders({ "//server/share/shared/logo.svg": "data:svg" }));
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("data:svg");
  });

  it("never asks the backend about a web or protocol-relative reference", async () => {
    const asked: string[] = [];
    const record = async (path: string) => {
      asked.push(path);
      return "data:x";
    };
    const doc = parse(
      '<img src="https://example.com/a.png"><img src="//cdn.example.com/b.png">' +
        '<img src="data:image/png;base64,AA"><link rel="stylesheet" href="https://cdn/x.css">',
    );
    await prepareHtmlDocument(doc, DOC, { readText: record, readImage: record });
    expect(asked).toEqual([]);
  });

  it("keeps an unreadable image's source rather than failing the page", async () => {
    const doc = parse('<img src="missing.png"><p>still here</p>');
    await prepareHtmlDocument(doc, DOC, loaders({}));
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("missing.png");
    expect(doc.querySelector("p")!.textContent).toBe("still here");
  });

  it("replaces a relative stylesheet with its text, and drops one it cannot read", async () => {
    const doc = parse(
      '<head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="gone.css">' +
        '<link rel="icon" href="favicon.ico"></head>',
    );
    await prepareHtmlDocument(
      doc,
      DOC,
      loaders({ "//server/share/reports/style.css": "body { color: red; }" }),
    );
    expect(Array.from(doc.querySelectorAll("style")).map((s) => s.textContent)).toEqual([
      "body { color: red; }",
    ]);
    // The unreadable stylesheet is gone; a non-stylesheet link is left alone.
    expect(Array.from(doc.querySelectorAll("link")).map((l) => l.getAttribute("rel"))).toEqual([
      "icon",
    ]);
  });

  it("removes a meta refresh and a <base>, and puts the CSP first in <head>", async () => {
    const doc = parse(
      '<head><base href="https://elsewhere/"><meta http-equiv="refresh" content="0;url=https://x">' +
        '<meta charset="utf-8"></head><body></body>',
    );
    await prepareHtmlDocument(doc, DOC, loaders({}));
    expect(doc.querySelector("base")).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    const first = doc.head.firstElementChild!;
    expect(first.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first.getAttribute("content")).toBe(HTML_PREVIEW_CSP);
    expect(doc.querySelector("meta[charset]")).not.toBeNull();
  });

  it("gives a fragment with no <head> one, so the CSP still applies", async () => {
    const doc = parse("<p>just a fragment</p>");
    await prepareHtmlDocument(doc, DOC, loaders({}));
    const out = serializeHtmlDocument(doc);
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("Content-Security-Policy");
    expect(out).toContain("<p>just a fragment</p>");
  });
});

describe("HTML_PREVIEW_CSP", () => {
  it("allows no scripts and no network source", () => {
    expect(HTML_PREVIEW_CSP).toContain("default-src 'none'");
    expect(HTML_PREVIEW_CSP).not.toMatch(/script-src|https?:|\*/);
  });
});
