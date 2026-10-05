import { describe, expect, it } from "vitest";

import { projectLanes } from "./task-lanes";
import type { Task } from "@/types";

const t = (id: string, project: string) => ({ id, project }) as Task;

describe("projectLanes", () => {
  it("orders rows by the given project order, with no project last", () => {
    const lanes = projectLanes([t("T-1", ""), t("T-2", "b"), t("T-3", "a")], ["a", "b"]);
    expect(lanes.map((l) => l.project)).toEqual(["a", "b", ""]);
  });

  it("skips projects that have no tasks", () => {
    const lanes = projectLanes([t("T-1", "b")], ["a", "b"]);
    expect(lanes.map((l) => l.project)).toEqual(["b"]);
  });

  it("keeps a project the order does not know, after the known ones", () => {
    const lanes = projectLanes([t("T-1", "zzz"), t("T-2", "a")], ["a"]);
    expect(lanes.map((l) => l.project)).toEqual(["a", "zzz"]);
  });

  it("gives each row only its own tasks", () => {
    const lanes = projectLanes([t("T-1", "a"), t("T-2", "b"), t("T-3", "a")], ["a", "b"]);
    expect(lanes[0].tasks.map((x) => x.id)).toEqual(["T-1", "T-3"]);
  });
});
