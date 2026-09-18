import { describe, expect, it } from "vitest";
import { unmetRequirements } from "@/lib/notices";
import type { Notice } from "@/types";

const notice = (plugin: Record<string, string>): Notice => ({
  id: "n",
  since: "0.139.0",
  severity: "breaking",
  title: "t",
  summary: "s",
  body: "b",
  requires: { plugin },
  action: { title: "a", body: "ab", project: "" },
});

describe("unmetRequirements", () => {
  it("is satisfied by the exact minimum", () => {
    expect(unmetRequirements(notice({ workhub: "0.40.0" }), { workhub: "0.40.0" })).toEqual([]);
  });

  it("is satisfied by anything newer", () => {
    expect(unmetRequirements(notice({ workhub: "0.40.0" }), { workhub: "0.41.2" })).toEqual([]);
  });

  it("names the plugin and the version needed when it is behind", () => {
    expect(unmetRequirements(notice({ workhub: "0.40.0" }), { workhub: "0.35.2" })).toEqual([
      "workhub 0.40.0+",
    ]);
  });

  it("treats a version it could not read as unmet", () => {
    // The pessimistic reading on purpose: the action files a task telling an
    // agent to run a skill, and a task pointing at a skill that is not there
    // fails part-way and leaves the vault wherever it got to. "Update this
    // first" is the cheaper wrong answer.
    expect(unmetRequirements(notice({ workhub: "0.40.0" }), {})).toEqual(["workhub 0.40.0+"]);
    expect(unmetRequirements(notice({ workhub: "0.40.0" }), { workhub: "" })).toEqual([
      "workhub 0.40.0+",
    ]);
  });

  it("asks for nothing when the notice requires nothing", () => {
    expect(unmetRequirements(notice({}), {})).toEqual([]);
  });
});
