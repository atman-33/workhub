// @vitest-environment happy-dom
// The store is localStorage; the default node environment has none.
import { beforeEach, describe, expect, it } from "vitest";
import {
  addNote,
  buildPrompt,
  clearNotes,
  contentStamp,
  type DocNote,
  notesAreStale,
  QUOTE_MAX,
  readNotes,
  removeNote,
  updateNote,
  writeNotes,
} from "./annotations";

const ROOT = "D-001";
const DOC = "notes/design.md";

function note(over: Partial<DocNote> = {}): Omit<DocNote, "id" | "createdAt"> {
  return { quote: "a phrase", occurrence: 0, comment: "shorten this", stamp: "s1", ...over };
}

beforeEach(() => {
  localStorage.clear();
});

describe("the store", () => {
  it("keeps notes per root and per document", () => {
    addNote(ROOT, DOC, [], note());
    addNote("D-002", DOC, [], note({ comment: "other root" }));
    addNote(ROOT, "notes/other.md", [], note({ comment: "other doc" }));

    expect(readNotes(ROOT, DOC).map((n) => n.comment)).toEqual(["shorten this"]);
    expect(readNotes("D-002", DOC).map((n) => n.comment)).toEqual(["other root"]);
    expect(readNotes(ROOT, "notes/other.md").map((n) => n.comment)).toEqual(["other doc"]);
  });

  it("gives every note an id and a timestamp", () => {
    const [saved] = addNote(ROOT, DOC, [], note());
    expect(saved.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
  });

  it("trims a long quote rather than storing the whole selection", () => {
    const [saved] = addNote(ROOT, DOC, [], note({ quote: "x".repeat(QUOTE_MAX + 50) }));
    expect(saved.quote).toHaveLength(QUOTE_MAX);
  });

  it("edits and deletes by id, and survives a reload", () => {
    let notes = addNote(ROOT, DOC, [], note());
    notes = addNote(ROOT, DOC, notes, note({ comment: "second" }));
    notes = updateNote(ROOT, DOC, notes, notes[0].id, "edited");
    expect(readNotes(ROOT, DOC).map((n) => n.comment)).toEqual(["edited", "second"]);

    notes = removeNote(ROOT, DOC, notes, notes[0].id);
    expect(readNotes(ROOT, DOC).map((n) => n.comment)).toEqual(["second"]);
  });

  it("drops the key when the last note goes, so an empty document stores nothing", () => {
    const notes = addNote(ROOT, DOC, [], note());
    clearNotes(ROOT, DOC);
    expect(readNotes(ROOT, DOC)).toEqual([]);
    expect(localStorage.length).toBe(0);
    // The same holds for removing them one at a time.
    writeNotes(ROOT, DOC, notes);
    removeNote(ROOT, DOC, notes, notes[0].id);
    expect(localStorage.length).toBe(0);
  });

  it("reads nothing rather than throwing on rubbish, and ignores rows that are not notes", () => {
    localStorage.setItem(`docs.notes.${ROOT}|${DOC}`, "not json");
    expect(readNotes(ROOT, DOC)).toEqual([]);
    localStorage.setItem(`docs.notes.${ROOT}|${DOC}`, JSON.stringify([{ nope: 1 }, note()]));
    expect(readNotes(ROOT, DOC)).toEqual([]);
  });

  it("has nowhere to put a note with no root or no document", () => {
    addNote("", DOC, [], note());
    addNote(ROOT, "", [], note());
    expect(localStorage.length).toBe(0);
    expect(readNotes("", DOC)).toEqual([]);
  });
});

describe("contentStamp", () => {
  it("changes when the text does", () => {
    expect(contentStamp("hello")).toBe(contentStamp("hello"));
    expect(contentStamp("hello")).not.toBe(contentStamp("hellp"));
    // Same length, different content: the hash is what separates them.
    expect(contentStamp("ab")).not.toBe(contentStamp("ba"));
  });

  it("marks notes stale only when they were taken against other text", () => {
    const notes = addNote(ROOT, DOC, [], note({ stamp: "s1" }));
    expect(notesAreStale(notes, "s1")).toBe(false);
    expect(notesAreStale(notes, "s2")).toBe(true);
    expect(notesAreStale([], "s2")).toBe(false);
  });
});

describe("buildPrompt", () => {
  const notes: DocNote[] = [
    { id: "1", line: 12, quote: "the  wordy\n bit", occurrence: 0, comment: "shorten", createdAt: "", stamp: "s" },
    { id: "2", quote: "no line here", occurrence: 1, comment: "fix the link", createdAt: "", stamp: "s" },
  ];
  const ctx = {
    rootName: "Design share",
    relPath: DOC,
    absPath: "G:/share/notes/design.md",
    notes,
    stale: false,
  };

  it("names the document both ways and lists every note", () => {
    const prompt = buildPrompt(ctx);
    expect(prompt).toContain("対象: Design share/notes/design.md");
    expect(prompt).toContain("絶対パス: G:/share/notes/design.md");
    // Whitespace in a quote is collapsed so one note stays one line.
    expect(prompt).toContain("- L12 「the wordy bit」 — shorten");
    expect(prompt).toContain("- 「no line here」 — fix the link");
  });

  it("always tells the agent to re-read the file and not to overwrite a share", () => {
    const prompt = buildPrompt(ctx);
    expect(prompt).toContain("読み直して");
    expect(prompt).toContain("直接上書きせず");
  });

  it("says so when the document has moved on since the notes were taken", () => {
    expect(buildPrompt(ctx)).not.toContain("更新されている");
    expect(buildPrompt({ ...ctx, stale: true })).toContain("更新されている");
  });
});
