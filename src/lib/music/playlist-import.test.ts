import { describe, expect, it, vi } from "vitest";
import {
  extractPlaylistId,
  hasPlaylistParam,
  fetchItemTitles,
  readPlaylistVideoIds,
  UNSUPPORTED_PLAYLIST_MESSAGE,
} from "./playlist-import";

describe("extractPlaylistId", () => {
  it("reads the list parameter from a playlist url", () => {
    expect(extractPlaylistId("https://www.youtube.com/playlist?list=PLabcdefghij")).toBe(
      "PLabcdefghij",
    );
  });

  it("reads the list parameter from a watch url", () => {
    expect(
      extractPlaylistId("https://www.youtube.com/watch?v=V4UL6BYgUXw&list=PLabcdefghij&index=3"),
    ).toBe("PLabcdefghij");
  });

  it("reads the list parameter from youtu.be and music.youtube.com", () => {
    expect(extractPlaylistId("https://youtu.be/V4UL6BYgUXw?list=PLabcdefghij")).toBe(
      "PLabcdefghij",
    );
    expect(
      extractPlaylistId("https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijkl"),
    ).toBe("OLAK5uy_abcdefghijkl");
  });

  it("accepts a bare playlist id", () => {
    expect(extractPlaylistId("PLabcdefghij")).toBe("PLabcdefghij");
  });

  it("returns null for a url without a list parameter", () => {
    expect(extractPlaylistId("https://www.youtube.com/watch?v=V4UL6BYgUXw")).toBeNull();
    expect(extractPlaylistId("")).toBeNull();
  });

  it("rejects auto-generated mixes and personal lists", () => {
    // RD* mixes are generated per viewer and LL/WL are private to the account,
    // so the IFrame player cannot enumerate them without a signed-in session.
    expect(extractPlaylistId("https://www.youtube.com/watch?v=V4UL6BYgUXw&list=RDV4UL6BYgUXw"))
      .toBeNull();
    expect(extractPlaylistId("https://www.youtube.com/playlist?list=LL")).toBeNull();
    expect(extractPlaylistId("https://www.youtube.com/playlist?list=WL")).toBeNull();
  });
});

describe("hasPlaylistParam", () => {
  it("reports a playlist even when it cannot be enumerated", () => {
    expect(hasPlaylistParam("https://www.youtube.com/watch?v=V4UL6BYgUXw&list=RDV4UL6BYgUXw")).toBe(
      true,
    );
    expect(hasPlaylistParam("https://www.youtube.com/watch?v=V4UL6BYgUXw")).toBe(false);
  });
});

const createPlayer = (frames: (string[] | null)[]) => {
  let call = 0;
  return {
    cuePlaylist: vi.fn(),
    getPlaylist: vi.fn(() => {
      const frame = frames[Math.min(call, frames.length - 1)];
      call += 1;
      return frame;
    }),
    stopVideo: vi.fn(),
  };
};

const immediateSleep = () => Promise.resolve();

describe("readPlaylistVideoIds", () => {
  it("cues the playlist and returns the ids once the player exposes them", async () => {
    const player = createPlayer([null, null, ["aaaaaaaaaaa", "bbbbbbbbbbb"]]);

    const ids = await readPlaylistVideoIds(player, "PLabcdefghij", { sleep: immediateSleep });

    expect(player.cuePlaylist).toHaveBeenCalledWith({
      listType: "playlist",
      list: "PLabcdefghij",
    });
    expect(ids).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  });

  it("stops the cued video so the import never takes over playback", async () => {
    const player = createPlayer([["aaaaaaaaaaa"]]);

    await readPlaylistVideoIds(player, "PLabcdefghij", { sleep: immediateSleep });

    expect(player.stopVideo).toHaveBeenCalled();
  });

  it("drops duplicate and malformed ids", async () => {
    const player = createPlayer([["aaaaaaaaaaa", "aaaaaaaaaaa", "", "short"]]);

    const ids = await readPlaylistVideoIds(player, "PLabcdefghij", { sleep: immediateSleep });

    expect(ids).toEqual(["aaaaaaaaaaa"]);
  });

  it("gives up with a message when the playlist never loads", async () => {
    const player = createPlayer([null]);

    await expect(
      readPlaylistVideoIds(player, "PLabcdefghij", { sleep: immediateSleep, attempts: 3 }),
    ).rejects.toThrow(UNSUPPORTED_PLAYLIST_MESSAGE);
    expect(player.getPlaylist).toHaveBeenCalledTimes(3);
  });

  it("gives up when the playlist loads empty", async () => {
    const player = createPlayer([[]]);

    await expect(
      readPlaylistVideoIds(player, "PLabcdefghij", { sleep: immediateSleep, attempts: 2 }),
    ).rejects.toThrow(UNSUPPORTED_PLAYLIST_MESSAGE);
  });
});

describe("fetchItemTitles", () => {
  it("resolves a title for every id and reports progress", async () => {
    const fetchTitle = vi.fn(async (id: string) => `Title ${id}`);
    const progress: number[] = [];

    const items = await fetchItemTitles(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"], {
      fetchTitle,
      concurrency: 2,
      onProgress: (done) => progress.push(done),
    });

    expect(items).toEqual([
      { id: "aaaaaaaaaaa", title: "Title aaaaaaaaaaa" },
      { id: "bbbbbbbbbbb", title: "Title bbbbbbbbbbb" },
      { id: "ccccccccccc", title: "Title ccccccccccc" },
    ]);
    expect(progress).toEqual([1, 2, 3]);
  });

  it("falls back to the id when the title lookup fails", async () => {
    const fetchTitle = vi.fn(async (id: string) => {
      if (id === "bbbbbbbbbbb") throw new Error("offline");
      return `Title ${id}`;
    });

    const items = await fetchItemTitles(["aaaaaaaaaaa", "bbbbbbbbbbb"], { fetchTitle });

    expect(items[1]).toEqual({ id: "bbbbbbbbbbb", title: "Video bbbbb" });
  });

  it("never runs more lookups at once than the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const fetchTitle = async (id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return `Title ${id}`;
    };

    await fetchItemTitles(["a", "b", "c", "d", "e"], { fetchTitle, concurrency: 2 });

    expect(peak).toBeLessThanOrEqual(2);
  });
});
