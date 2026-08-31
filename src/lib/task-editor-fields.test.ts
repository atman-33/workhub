import { describe, expect, it } from "vitest";
import {
  draftFromTask,
  fieldsFromDraft,
  mergeExternalTask,
  type TaskDraft,
} from "./task-editor-fields";
import type { Task } from "@/types";

const TASK: Task = {
  id: "T-0001",
  title: "A task",
  status: "todo",
  assignee: "me",
  project: "workhub",
  priority: "medium",
  model: "",
  order: null,
  due: "2026-08-31",
  tags: ["one", "two"],
  archived: false,
  confirm: false,
  worktree: false,
  blocked: false,
  blocked_note: "",
  blocked_since: "",
  created: "2026-08-30",
  updated: "2026-08-30",
  file: "tasks/T-0001 A task.md",
  body: "## Description\n\nThe body.\n",
};

const DRAFT: TaskDraft = draftFromTask(TASK);

describe("fieldsFromDraft", () => {
  it("without a dirty set, maps every frontmatter field for create", () => {
    const fields = fieldsFromDraft(DRAFT);
    expect(Object.keys(fields).sort()).toEqual(
      [
        "assignee",
        "blocked",
        "blockedNote",
        "blockedSince",
        "confirm",
        "due",
        "model",
        "priority",
        "project",
        "status",
        "tags",
        "title",
        "worktree",
      ].sort(),
    );
    expect(fields).toMatchObject({
      title: "A task",
      status: "todo",
      due: "2026-08-31",
      tags: ["one", "two"],
    });
  });

  it("with a dirty set, carries only the touched fields", () => {
    const fields = fieldsFromDraft(DRAFT, new Set(["title", "status"]));
    expect(Object.keys(fields).sort()).toEqual(["status", "title"]);
    expect(fields).toEqual({ title: "A task", status: "todo" });
  });

  it("never leaks the body draft (content) into the frontmatter fields", () => {
    const fields = fieldsFromDraft(DRAFT, new Set(["content", "title"]));
    expect(Object.keys(fields)).toEqual(["title"]);
  });

  it("splits and trims the comma-separated tags", () => {
    expect(fieldsFromDraft({ ...DRAFT, tags: " a , b ,, " }).tags).toEqual(["a", "b"]);
    expect(fieldsFromDraft({ ...DRAFT, tags: " , " }).tags).toEqual([]);
  });
});

describe("mergeExternalTask", () => {
  it("keeps dirty fields and takes the rest from the fresh snapshot", () => {
    const edited: TaskDraft = { ...DRAFT, title: "Typed title", content: "Typed text" };
    const fresh: TaskDraft = { ...DRAFT, status: "doing", title: "Board title" };
    const merged = mergeExternalTask(edited, fresh, new Set(["title", "content"]));
    expect(merged).toEqual({
      ...edited,
      status: "doing",
      // The board's title is ignored: the user is mid-edit on it.
      title: "Typed title",
      content: "Typed text",
    });
  });

  it("returns null when nothing outside the dirty set changed", () => {
    const fresh: TaskDraft = { ...DRAFT, title: "Changed where dirty" };
    expect(mergeExternalTask(DRAFT, fresh, new Set(["title"]))).toBeNull();
  });

  it("picks up every untouched field that moved, including the body draft", () => {
    const fresh: TaskDraft = { ...DRAFT, status: "review", content: "New body" };
    expect(mergeExternalTask(DRAFT, fresh, new Set())).toEqual({
      ...DRAFT,
      status: "review",
      content: "New body",
    });
  });
});
