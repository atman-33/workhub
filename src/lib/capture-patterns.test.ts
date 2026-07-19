import { describe, expect, it } from "vitest";
import {
  AUTO_PASTE_MAX_CHARS,
  matchCapturePatterns,
  shouldAutoPaste,
} from "./capture-patterns";

const ids = (text: string) => matchCapturePatterns(text).map((p) => p.id);

describe("matchCapturePatterns", () => {
  it("matches a Slack thread link", () => {
    expect(
      ids("https://myteam.slack.com/archives/C0123ABC/p1721200000000000"),
    ).toEqual(["slack"]);
  });

  it("matches a GitHub pull request link", () => {
    expect(ids("https://github.com/atman-33/workhub/pull/54")).toEqual([
      "github-pr",
    ]);
  });

  it("matches a monday.com item link", () => {
    expect(
      ids(
        "https://gpbjk0304s-team-company.monday.com/boards/18422719593/pulses/12570249669/posts/5386039986",
      ),
    ).toEqual(["monday"]);
  });

  it("matches when the link is embedded in surrounding text", () => {
    expect(ids("reply later: https://a-b1.slack.com/archives/C1/p2 !")).toEqual([
      "slack",
    ]);
  });

  it("reports every pattern present", () => {
    expect(
      ids(
        "https://myteam.slack.com/archives/C1/p2 and https://github.com/o/r/pull/1",
      ),
    ).toEqual(["slack", "github-pr"]);
  });

  it("ignores GitHub URLs that are not pull requests", () => {
    expect(ids("https://github.com/atman-33/workhub")).toEqual([]);
    expect(ids("https://github.com/atman-33/workhub/issues/12")).toEqual([]);
  });

  it("ignores look-alike hosts and plain text", () => {
    expect(ids("https://notslack.com/archives/C1")).toEqual([]);
    expect(ids("just a note about slack.com pricing")).toEqual([]);
    expect(ids("")).toEqual([]);
  });
});

describe("shouldAutoPaste", () => {
  it("is false for empty clipboard", () => {
    expect(shouldAutoPaste("")).toBe(false);
    expect(shouldAutoPaste("   \n ")).toBe(false);
  });

  it("is true for a recognized link", () => {
    expect(shouldAutoPaste("https://myteam.slack.com/archives/C1/p2")).toBe(
      true,
    );
    expect(shouldAutoPaste("https://github.com/o/r/pull/7")).toBe(true);
    expect(shouldAutoPaste("https://acme.monday.com/boards/1/pulses/2")).toBe(
      true,
    );
  });

  it("is false for unrelated clipboard content", () => {
    expect(shouldAutoPaste("const x = 1;")).toBe(false);
    expect(shouldAutoPaste("a short note to self")).toBe(false);
    expect(shouldAutoPaste("https://example.com/some/page")).toBe(false);
  });

  it("holds back a recognized link buried in a wall of text", () => {
    const wall = `https://myteam.slack.com/archives/C1/p2\n${"x".repeat(
      AUTO_PASTE_MAX_CHARS,
    )}`;
    expect(shouldAutoPaste(wall)).toBe(false);
  });
});
