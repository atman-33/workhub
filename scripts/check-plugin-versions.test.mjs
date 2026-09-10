import { describe, expect, it } from "vitest";
import { pluginsInDiff, versionOf } from "./check-plugin-versions.mjs";

describe("pluginsInDiff", () => {
  it("names each plugin a changed file belongs to, once", () => {
    expect(
      pluginsInDiff([
        "plugins/workhub/scripts/task-cli.mjs",
        "plugins/workhub/skills/task-start/SKILL.md",
        "plugins/persona/README.md",
      ]),
    ).toEqual(["persona", "workhub"]);
  });

  it("ignores everything outside plugins/", () => {
    expect(pluginsInDiff(["src/App.tsx", "CHANGELOG.md", "plugins.md"])).toEqual([]);
  });

  it("reads a backslash path, since git on Windows can hand one over", () => {
    expect(pluginsInDiff(["plugins\\workhub\\README.md"])).toEqual(["workhub"]);
  });

  it("does not treat a file directly under plugins/ as a plugin", () => {
    expect(pluginsInDiff(["plugins/README.md"])).toEqual([]);
  });
});

describe("versionOf", () => {
  it("reads the version field", () => {
    expect(versionOf('{"name":"workhub","version":"0.32.0"}')).toBe("0.32.0");
  });

  it("is null for a manifest without one, or one that will not parse", () => {
    expect(versionOf('{"name":"workhub"}')).toBeNull();
    expect(versionOf('{"version":31}')).toBeNull();
    expect(versionOf("not json")).toBeNull();
  });
});
