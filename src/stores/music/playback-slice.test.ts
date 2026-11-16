import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/music/types";
import { useMusicStore } from "./index";

const playlist = (id: string, itemIds: string[]): Playlist => ({
  id,
  name: id,
  items: itemIds.map((itemId) => ({ id: itemId, title: `title-${itemId}` })),
});

const seed = (opts: { isShuffle: boolean; loopMode?: "all" | "one"; startId?: string }) => {
  const list = playlist("a", ["v1", "v2", "v3"]);
  const startId = opts.startId ?? "v1";
  useMusicStore.setState({
    playlists: [list],
    activePlaylistId: "a",
    currentVideoId: startId,
    currentIndex: list.items.findIndex((item) => item.id === startId),
    isPlaying: true,
    loopMode: opts.loopMode ?? "all",
    isShuffle: opts.isShuffle,
    shuffleQueue: {},
    playerInstance: null,
    hydrated: true,
  });
};

const currentId = () => useMusicStore.getState().currentVideoId;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("playNext / playPrevious without shuffle", () => {
  beforeEach(() => seed({ isShuffle: false }));

  it("steps through the playlist in order", () => {
    useMusicStore.getState().playNext();
    expect(currentId()).toBe("v2");
    useMusicStore.getState().playNext();
    expect(currentId()).toBe("v3");
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v2");
  });

  it("wraps around at both ends in loop-all mode", () => {
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v3");
    useMusicStore.getState().playNext();
    expect(currentId()).toBe("v1");
  });

  it("stops at the end in loop-one mode", () => {
    seed({ isShuffle: false, loopMode: "one", startId: "v3" });
    useMusicStore.getState().playNext();
    expect(useMusicStore.getState().isPlaying).toBe(false);
    expect(currentId()).toBe("v3");
  });
});

describe("playNext with shuffle", () => {
  beforeEach(() => seed({ isShuffle: true }));

  it("plays every track once before repeating", () => {
    const seen = new Set<string>(["v1"]);
    useMusicStore.getState().playNext();
    seen.add(currentId() as string);
    useMusicStore.getState().playNext();
    seen.add(currentId() as string);
    expect(seen).toEqual(new Set(["v1", "v2", "v3"]));
  });
});

describe("playPrevious with shuffle (current behavior, T-1270)", () => {
  beforeEach(() => seed({ isShuffle: true }));

  it("draws a random track instead of returning to the previous one", () => {
    // Math.random() = 0 always picks the first candidate in the queue.
    vi.spyOn(Math, "random").mockReturnValue(0);
    useMusicStore.getState().playNext();
    expect(currentId()).toBe("v2");
    useMusicStore.getState().playPrevious();
    // Plays v3, a track that was never played, rather than the earlier v1.
    expect(currentId()).toBe("v3");
  });
});
