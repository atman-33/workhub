import { describe, expect, it } from "vitest";
import { GOLDEN } from "./golden-fixtures";

/**
 * The golden round trip (T-1219): for every Kind, what a deliberately messy
 * note parses to and what is written back. The snapshots are the file format.
 * A migration that changes one of them changes how existing notes are saved:
 * stop and ask, do not update the snapshot.
 */
const TODAY = "2026-11-11";

describe.each(Object.entries(GOLDEN))("golden %s", (_kind, golden) => {
  const doc = golden.parse(golden.content, "fallback") as never;

  it("parses to a stable model", () => {
    expect(doc).toMatchSnapshot();
  });

  it("counts the lines it keeps but cannot show", () => {
    expect(golden.warnings(doc)).toMatchSnapshot();
  });

  it("writes the note back as it always has", () => {
    expect(golden.serialize(golden.content, doc, TODAY)).toMatchSnapshot();
  });

  it("is stable once written (a second round changes nothing)", () => {
    const once = golden.serialize(golden.content, doc, TODAY);
    const again = golden.serialize(once, golden.parse(once, "fallback") as never, TODAY);
    expect(again).toBe(once);
  });

  it("keeps the file's CRLF line endings and reads it as the LF note", () => {
    const crlf = golden.content.replace(/\n/g, "\r\n");
    const lf = golden.serialize(golden.content, doc, TODAY);
    const written = golden.serialize(crlf, golden.parse(crlf, "fallback") as never, TODAY);
    expect(written).toBe(lf.replace(/\n/g, "\r\n"));
  });
});

describe("a second @x,y or ^mark on a line", () => {
  // Pinned as it is today: the first `@` is the position, a later one is title
  // text (so it is written before the position on the next save). Not a
  // contract worth keeping, but a change to it changes saved files.
  it("stays part of the title", () => {
    const flow = GOLDEN.flow.parse("## Steps\n\n- F-001 a @1,2 @3,4\n", "") as {
      steps: { title: string; x?: number; y?: number }[];
    };
    expect(flow.steps[0]).toMatchObject({ title: "a @3,4", x: 1, y: 2 });
    const pfd = GOLDEN.pfd.parse("## Nodes\n\n- P-001 a @1,2 @3,4\n", "") as {
      nodes: { title: string; x?: number; y?: number }[];
    };
    expect(pfd.nodes[0]).toMatchObject({ title: "a @3,4", x: 1, y: 2 });
    const marked = GOLDEN.flow.parse("## Steps\n\n- F-001 a ^end ^start\n", "") as {
      steps: { title: string; kind: string }[];
    };
    expect(marked.steps[0]).toMatchObject({ title: "a ^start", kind: "end" });
  });
});
