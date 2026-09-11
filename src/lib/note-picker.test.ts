import { describe, expect, it } from "vitest";
import { resolveOpenNote } from "./note-picker";

function file(path: string) {
  return { path };
}

const P = "C:/vault/projects";

describe("resolveOpenNote", () => {
  it("keeps the open note while both listings still account for it", () => {
    const files = [file(`${P}/0010-workhub/schedules/a.md`), file(`${P}/0010-workhub/schedules/b.md`)];
    expect(
      resolveOpenNote({ path: `${P}/0010-workhub/schedules/b.md`, files, projects: ["workhub"] }),
    ).toBe(`${P}/0010-workhub/schedules/b.md`);
  });

  it("opens the first note when none is open", () => {
    const files = [file(`${P}/0010-workhub/schedules/a.md`)];
    expect(resolveOpenNote({ path: "", files, projects: ["workhub"] })).toBe(
      `${P}/0010-workhub/schedules/a.md`,
    );
  });

  it("takes over when the open note is no longer offered", () => {
    const files = [file(`${P}/0020-demo/schedules/x.md`)];
    expect(
      resolveOpenNote({
        path: `${P}/0010-workhub/schedules/a.md`,
        files,
        projects: ["workhub", "demo"],
      }),
    ).toBe(`${P}/0020-demo/schedules/x.md`);
  });

  it("lets go of a note whose project has left the list", () => {
    const open = `${P}/0010-workhub/schedules/a.md`;
    expect(resolveOpenNote({ path: open, files: [file(open)], projects: ["demo"] })).toBe("");
  });

  // The loop T-0284 was reported for: the first file is one the old
  // close-it effect rejected, so clearing the path only fed it straight back.
  // Skipping past it is what makes a single write enough.
  it("skips an orphaned first file instead of handing it back", () => {
    const files = [file(`${P}/0010-gone/schedules/a.md`), file(`${P}/0020-demo/schedules/b.md`)];
    expect(resolveOpenNote({ path: "", files, projects: ["demo"] })).toBe(
      `${P}/0020-demo/schedules/b.md`,
    );
  });

  // The property the whole design rests on: whatever comes back is a value
  // that comes back again unchanged, so the effect applying it settles after
  // one write rather than ping-ponging.
  it("returns a settled answer — resolving twice changes nothing", () => {
    const files = [file(`${P}/0010-gone/schedules/a.md`), file(`${P}/0020-demo/schedules/b.md`)];
    const projects = ["demo"];
    const once = resolveOpenNote({ path: "", files, projects });
    expect(resolveOpenNote({ path: once, files, projects })).toBe(once);
  });

  it("returns nothing when there is nothing left to open", () => {
    expect(resolveOpenNote({ path: "", files: [], projects: ["workhub"] })).toBe("");
    expect(
      resolveOpenNote({
        path: `${P}/0010-workhub/schedules/a.md`,
        files: [],
        projects: ["workhub"],
      }),
    ).toBe("");
  });

  // A note outside `projects/` has no owner to lose, so it is never judged
  // orphaned — only the file list decides whether it stays.
  it("never orphans a note that sits outside a project", () => {
    const loose = "C:/vault/scratch/a.md";
    expect(resolveOpenNote({ path: loose, files: [file(loose)], projects: [] })).toBe(loose);
  });
});
