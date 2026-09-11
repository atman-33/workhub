import { describe, expect, it } from "vitest";
import { calloutKind, colonBlocksToCallouts } from "./callouts";

describe("colonBlocksToCallouts", () => {
  it("converts NotePM's three levels", () => {
    expect(colonBlocksToCallouts(":::note info\n\n情報\n:::")).toBe(
      "> [!info|notitle]\n> \n> 情報\n",
    );
    expect(colonBlocksToCallouts(":::note warn\n警告\n:::")).toBe("> [!warning|notitle]\n> 警告\n");
    expect(colonBlocksToCallouts(":::note alert\n危険\n:::")).toBe("> [!danger|notitle]\n> 危険\n");
  });

  it("treats a missing or unknown NotePM type as info", () => {
    expect(colonBlocksToCallouts(":::note\nx\n:::")).toBe("> [!info|notitle]\n> x\n");
    expect(colonBlocksToCallouts(":::note other\nx\n:::")).toBe("> [!info|notitle]\n> x\n");
  });

  it("converts Zenn's message and message alert", () => {
    expect(colonBlocksToCallouts(":::message\nx\n:::")).toBe("> [!warning|notitle]\n> x\n");
    expect(colonBlocksToCallouts(":::message alert\nx\n:::")).toBe("> [!danger|notitle]\n> x\n");
  });

  it("ends the quote at the closing line so the next paragraph stays outside", () => {
    expect(colonBlocksToCallouts(":::note info\nin\n:::\nout")).toBe(
      "> [!info|notitle]\n> in\n\nout",
    );
  });

  it("leaves fenced code alone, inside a block or out", () => {
    const fenced = "```md\n:::note info\n:::\n```";
    expect(colonBlocksToCallouts(fenced)).toBe(fenced);
    expect(colonBlocksToCallouts(":::message\n~~~\n:::\n~~~\n:::")).toBe(
      "> [!warning|notitle]\n> ~~~\n> :::\n> ~~~\n",
    );
  });

  it("nests, pairing a closing line with the opener of the same length", () => {
    expect(colonBlocksToCallouts("::::message alert\n:::note info\nx\n:::\ny\n::::")).toBe(
      "> [!danger|notitle]\n> > [!info|notitle]\n> > x\n>\n> y\n",
    );
  });

  it("converts Zenn's details into a folded callout titled by the rest of the line", () => {
    expect(colonBlocksToCallouts(":::details タイトル は ここ\nbody\n:::")).toBe(
      "> [!note|details]- タイトル は ここ\n> body\n",
    );
    expect(colonBlocksToCallouts(":::details\nbody\n:::")).toBe("> [!note|details]-\n> body\n");
  });

  it("nests a message inside a Zenn details written with ::::", () => {
    expect(colonBlocksToCallouts("::::details Outer\n:::message\nx\n:::\n::::")).toBe(
      "> [!note|details]- Outer\n> > [!warning|notitle]\n> > x\n>\n",
    );
  });

  it("passes other ::: blocks through without letting them close ours", () => {
    const docusaurus = "::::message\n:::tip Title\nbody\n:::\n::::";
    expect(colonBlocksToCallouts(docusaurus)).toBe(
      "> [!warning|notitle]\n> :::tip Title\n> body\n> :::\n",
    );
  });

  it("closes a block left open at the end of the document", () => {
    expect(colonBlocksToCallouts(":::note warn\nx")).toBe("> [!warning|notitle]\n> x");
  });

  it("returns text without ::: unchanged", () => {
    const text = "a:b\r\n15:00";
    expect(colonBlocksToCallouts(text)).toBe(text);
  });
});

describe("calloutKind", () => {
  it("maps Obsidian's aliases and falls back to note", () => {
    expect(calloutKind("TLDR")).toBe("abstract");
    expect(calloutKind("caution")).toBe("warning");
    expect(calloutKind("error")).toBe("danger");
    expect(calloutKind("cite")).toBe("quote");
    expect(calloutKind("whatever")).toBe("note");
  });
});
