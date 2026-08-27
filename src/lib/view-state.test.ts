import { afterEach, describe, expect, it, vi } from "vitest";
import { readViewState, writeViewState } from "./view-state";

/** Minimal in-memory localStorage — the default vitest env is node, which has none. */
function stubStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

/** Storage that throws the way a private-mode browser does. */
function stubBrokenStorage() {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readViewState", () => {
  it("reads the project and path stored for the view", () => {
    stubStorage({
      "schedule.lastProject": "workhub",
      "schedule.lastPath": "projects/workhub/schedules/plan.md",
    });
    expect(readViewState("schedule")).toEqual({
      project: "workhub",
      path: "projects/workhub/schedules/plan.md",
    });
  });

  it("reads missing entries as empty strings", () => {
    stubStorage();
    expect(readViewState("mindmap")).toEqual({ project: "", path: "" });
  });

  it("keeps views separate", () => {
    stubStorage({ "mindmap.lastPath": "a.md", "schedule.lastPath": "b.md" });
    expect(readViewState("mindmap").path).toBe("a.md");
    expect(readViewState("schedule").path).toBe("b.md");
  });

  it("falls back to empty state when storage is unavailable", () => {
    stubBrokenStorage();
    expect(readViewState("schedule")).toEqual({ project: "", path: "" });
  });
});

describe("writeViewState", () => {
  it("persists a field under the view's key", () => {
    const store = stubStorage();
    writeViewState("mindmap", "path", "projects/workhub/mindmaps/ideas.md");
    writeViewState("mindmap", "project", "workhub");
    expect(store.get("mindmap.lastPath")).toBe("projects/workhub/mindmaps/ideas.md");
    expect(store.get("mindmap.lastProject")).toBe("workhub");
  });

  it("round-trips through readViewState", () => {
    stubStorage();
    writeViewState("schedule", "path", "x.md");
    expect(readViewState("schedule")).toEqual({ project: "", path: "x.md" });
  });

  it("does not throw when storage is unavailable", () => {
    stubBrokenStorage();
    expect(() => writeViewState("schedule", "path", "x.md")).not.toThrow();
  });
});
