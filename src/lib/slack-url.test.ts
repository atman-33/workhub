import { describe, expect, it } from "vitest";
import { containsSlackUrl } from "./slack-url";

describe("containsSlackUrl", () => {
  it("matches a Slack thread link", () => {
    expect(
      containsSlackUrl(
        "https://myteam.slack.com/archives/C0123ABC/p1721200000000000",
      ),
    ).toBe(true);
  });

  it("matches when the link is embedded in surrounding text", () => {
    expect(
      containsSlackUrl("reply later: https://a-b1.slack.com/archives/C1/p2 !"),
    ).toBe(true);
  });

  it("ignores non-Slack URLs and plain text", () => {
    expect(containsSlackUrl("https://github.com/atman-33/workhub")).toBe(false);
    expect(containsSlackUrl("just a note about slack.com pricing")).toBe(false);
    expect(containsSlackUrl("https://notslack.com/archives/C1")).toBe(false);
  });
});
