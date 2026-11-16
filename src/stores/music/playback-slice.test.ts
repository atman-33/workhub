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
    playHistory: {},
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

describe("playPrevious with shuffle (T-1270)", () => {
  beforeEach(() => seed({ isShuffle: true }));

  it("goes back through the tracks that actually played, newest first", () => {
    useMusicStore.getState().playNext();
    const second = currentId();
    useMusicStore.getState().playNext();
    const third = currentId();
    expect(new Set(["v1", second, third]).size).toBe(3);

    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe(second);
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v1");
  });

  it("restarts the current track when there is no history", () => {
    const loadVideoById = vi.fn();
    useMusicStore.setState({
      playerInstance: { loadVideoById, playVideo: vi.fn() } as never,
    });
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v1");
    expect(loadVideoById).toHaveBeenCalledWith("v1");
    expect(useMusicStore.getState().isPlaying).toBe(true);
  });

  it("returns to the track played before a manual pick", () => {
    useMusicStore.getState().play("v3");
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v1");
  });

  it("does not record a replay of the same track as history", () => {
    useMusicStore.getState().play("v1");
    expect(useMusicStore.getState().playHistory.a ?? []).toEqual([]);
  });

  it("skips tracks removed from the playlist", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    useMusicStore.getState().playNext(); // v1 -> v2
    useMusicStore.getState().playNext(); // v2 -> v3
    useMusicStore.getState().removeFromPlaylist(1); // drop v2
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v1");
  });

  it("caps the history at 100 tracks", () => {
    const ids = Array.from({ length: 150 }, (_, i) => `x${i}`);
    useMusicStore.setState({
      playlists: [playlist("a", ids)],
      currentVideoId: "x0",
      currentIndex: 0,
    });
    for (let i = 1; i < 150; i++) {
      useMusicStore.getState().play(ids[i]);
    }
    expect(useMusicStore.getState().playHistory.a).toHaveLength(100);
  });

  it("drops the history when shuffle is switched off", () => {
    useMusicStore.getState().playNext();
    useMusicStore.getState().toggleShuffle();
    expect(useMusicStore.getState().playHistory).toEqual({});
  });
});

describe("playPrevious without shuffle keeps stepping back by position", () => {
  it("ignores the history", () => {
    seed({ isShuffle: false, startId: "v3" });
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v2");
  });
});
