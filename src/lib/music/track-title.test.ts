import { describe, expect, it } from "vitest";
import { currentTrackTitle } from "./track-title";
import type { Playlist } from "./types";

const playlist: Playlist = {
  id: "p1",
  name: "Focus",
  items: [
    { id: "aaaaaaaaaaa", title: "Lo-fi beats" },
    { id: "bbbbbbbbbbb" },
  ],
};

describe("currentTrackTitle", () => {
  it("returns null when nothing is loaded", () => {
    expect(currentTrackTitle(playlist, null)).toBeNull();
  });

  it("returns the playlist entry's title", () => {
    expect(currentTrackTitle(playlist, "aaaaaaaaaaa")).toBe("Lo-fi beats");
  });

  it("falls back to a short video id when the entry has no title", () => {
    expect(currentTrackTitle(playlist, "bbbbbbbbbbb")).toBe("Video bbbbb");
  });

  it("falls back when the video is not in the playlist", () => {
    expect(currentTrackTitle(playlist, "ccccccccccc")).toBe("Video ccccc");
  });

  it("falls back when there is no active playlist", () => {
    expect(currentTrackTitle(null, "aaaaaaaaaaa")).toBe("Video aaaaa");
  });
});
