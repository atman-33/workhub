import { describe, expect, it } from "vitest";

import { limitArchived } from "./archive-limit";
import type { Task } from "@/types";

const task = (id: string, archived: boolean) => ({ id, archived }) as Task;

describe("limitArchived", () => {
  const all = [
    task("T-0001", true),
    task("T-0002", false),
    task("T-0003", true),
    task("T-0004", true),
    task("T-0005", false),
  ];

  it("returns the input untouched when archived tasks fit the limit", () => {
    const r = limitArchived(all, 3);
    expect(r.tasks).toBe(all);
    expect(r.archivedTotal).toBe(3);
    expect(r.archivedShown).toBe(3);
  });

  it("keeps the newest archived tasks and every active one, in input order", () => {
    const r = limitArchived(all, 2);
    expect(r.tasks.map((t) => t.id)).toEqual(["T-0002", "T-0003", "T-0004", "T-0005"]);
    expect(r.archivedTotal).toBe(3);
    expect(r.archivedShown).toBe(2);
  });

  it("handles a limit of zero", () => {
    const r = limitArchived(all, 0);
    expect(r.tasks.map((t) => t.id)).toEqual(["T-0002", "T-0005"]);
  });
});
