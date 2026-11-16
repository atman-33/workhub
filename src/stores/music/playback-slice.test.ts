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

describe("playTrackInPlaylist (T-1271)", () => {
  const seedTwo = (isShuffle: boolean) => {
    const loadVideoById = vi.fn();
    useMusicStore.setState({
      playlists: [playlist("a", ["v1", "v2", "v3"]), playlist("b", ["w1", "w2", "w3"])],
      activePlaylistId: "a",
      currentVideoId: "v2",
      currentIndex: 1,
      isPlaying: false,
      isShuffle,
      shuffleQueue: {},
      playHistory: {},
      playerInstance: { loadVideoById, playVideo: vi.fn() } as never,
      hydrated: true,
    });
    return loadVideoById;
  };

  it("plays a track of the active playlist like play()", () => {
    const loadVideoById = seedTwo(false);
    useMusicStore.getState().playTrackInPlaylist("a", "v3");
    const state = useMusicStore.getState();
    expect(state.activePlaylistId).toBe("a");
    expect(state.currentVideoId).toBe("v3");
    expect(state.currentIndex).toBe(2);
    expect(state.isPlaying).toBe(true);
    expect(loadVideoById).toHaveBeenCalledTimes(1);
    expect(loadVideoById).toHaveBeenCalledWith("v3");
  });

  it("switches playlist and plays the chosen track, not the first one", () => {
    const loadVideoById = seedTwo(false);
    useMusicStore.getState().playTrackInPlaylist("b", "w3");
    const state = useMusicStore.getState();
    expect(state.activePlaylistId).toBe("b");
    expect(state.currentVideoId).toBe("w3");
    expect(state.currentIndex).toBe(2);
    expect(state.isPlaying).toBe(true);
    // Never goes through the playlist's first track.
    expect(loadVideoById).toHaveBeenCalledTimes(1);
    expect(loadVideoById).toHaveBeenCalledWith("w3");
  });

  it("continues in the new playlist's own order afterwards", () => {
    seedTwo(false);
    useMusicStore.getState().playTrackInPlaylist("b", "w2");
    useMusicStore.getState().playNext();
    expect(currentId()).toBe("w3");
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("w2");
  });

  it("starts a fresh shuffle history and queue in the new playlist", () => {
    seedTwo(true);
    useMusicStore.setState({ playHistory: { b: ["stale"] }, shuffleQueue: { b: ["w1"] } });
    useMusicStore.getState().playTrackInPlaylist("b", "w2");
    const state = useMusicStore.getState();
    // The track left behind in playlist a must not leak into b's history.
    expect(state.playHistory.b ?? []).toEqual([]);
    expect(state.shuffleQueue.b).not.toContain("w2");
    expect(new Set(state.shuffleQueue.b)).toEqual(new Set(["w1", "w3"]));
  });

  it("goes back to the previous track only through tracks played in the new playlist", () => {
    seedTwo(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
    useMusicStore.getState().playTrackInPlaylist("b", "w2");
    useMusicStore.getState().playNext();
    const second = currentId();
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("w2");
    expect(second).not.toBe("w2");
    useMusicStore.getState().playPrevious();
    // Nothing earlier: restarts, rather than jumping to a track of playlist a.
    expect(currentId()).toBe("w2");
  });

  it("keeps the shuffle history when the track is in the active playlist", () => {
    seedTwo(true);
    useMusicStore.getState().playTrackInPlaylist("a", "v3");
    expect(useMusicStore.getState().playHistory.a).toEqual(["v2"]);
    useMusicStore.getState().playPrevious();
    expect(currentId()).toBe("v2");
  });

  it("ignores an unknown playlist or track", () => {
    const loadVideoById = seedTwo(false);
    useMusicStore.getState().playTrackInPlaylist("zzz", "v1");
    useMusicStore.getState().playTrackInPlaylist("b", "nope");
    const state = useMusicStore.getState();
    expect(state.activePlaylistId).toBe("a");
    expect(state.currentVideoId).toBe("v2");
    expect(loadVideoById).not.toHaveBeenCalled();
  });
});
