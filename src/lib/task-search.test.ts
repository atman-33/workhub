import { describe, expect, it } from "vitest";

import { matchesTaskSearch, searchTerms } from "./task-search";
import type { Task } from "@/types";

const task = {
  id: "T-0641",
  title: "タスクのテキスト検索",
  project: "workhub",
  backlog: "B-046",
  tags: ["search"],
} as Task;

describe("matchesTaskSearch", () => {
  it("matches everything for a blank query", () => {
    expect(matchesTaskSearch(task, searchTerms("  "))).toBe(true);
  });

  it("matches id, title, project, backlog and tags case-insensitively", () => {
    for (const q of ["t-0641", "テキスト", "WORKHUB", "b-046", "#search".slice(1)]) {
      expect(matchesTaskSearch(task, searchTerms(q))).toBe(true);
    }
  });

  it("requires every term", () => {
    expect(matchesTaskSearch(task, searchTerms("検索 workhub"))).toBe(true);
    expect(matchesTaskSearch(task, searchTerms("検索 missing"))).toBe(false);
  });
});
