import { describe, expect, it } from "vitest";
import {
  PROJECTS_LIST_OPEN_KEY,
  readProjectsListOpen,
  writeProjectsListOpen,
  type ListOpenStorage,
} from "./project-list-panel";

function memoryStorage(): ListOpenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("projects list panel", () => {
  it("is shown when nothing is stored, or the value is unknown", () => {
    const s = memoryStorage();
    expect(readProjectsListOpen(s)).toBe(true);
    s.data.set(PROJECTS_LIST_OPEN_KEY, "banana");
    expect(readProjectsListOpen(s)).toBe(true);
  });

  it("remembers hidden and shown", () => {
    const s = memoryStorage();
    writeProjectsListOpen(s, false);
    expect(readProjectsListOpen(s)).toBe(false);
    writeProjectsListOpen(s, true);
    expect(readProjectsListOpen(s)).toBe(true);
  });

  it("survives a missing or throwing storage", () => {
    expect(readProjectsListOpen(undefined)).toBe(true);
    expect(() => writeProjectsListOpen(undefined, false)).not.toThrow();
    const broken: ListOpenStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readProjectsListOpen(broken)).toBe(true);
    expect(() => writeProjectsListOpen(broken, false)).not.toThrow();
  });
});
