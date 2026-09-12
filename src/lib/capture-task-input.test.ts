import { describe, expect, it } from "vitest";
import { captureTaskInput } from "./capture-task-input";
import { matchCapturePatterns } from "./capture-patterns";

describe("captureTaskInput", () => {
  it("defaults confirm on, matching a new task in the editor", () => {
    const input = captureTaskInput({
      title: "Look at the PR",
      description: "",
      project: "",
      matched: [],
    });
    expect(input.confirm).toBe(true);
  });

  it("lands in the inbox as the owner's own task", () => {
    const input = captureTaskInput({
      title: "  Look at the PR  ",
      description: "",
      project: "workhub",
      matched: [],
    });
    expect(input.title).toBe("Look at the PR");
    expect(input.status).toBe("inbox");
    expect(input.assignee).toBe("me");
    expect(input.project).toBe("workhub");
  });

  it("tags the recognized sources and wraps the description in a body", () => {
    const description = "https://github.com/atman-33/workhub/pull/200";
    const input = captureTaskInput({
      title: "Review",
      description: `  ${description}  `,
      project: "",
      matched: matchCapturePatterns(description),
    });
    expect(input.tags).toEqual(["github-pr"]);
    expect(input.body).toBe(
      ["", "## Description", "", description, "", "## Results", ""].join("\n"),
    );
  });
});
