// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMusicStore } from "@/stores/music";

const { listeners, updateMediaSession } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: string }) => void>(),
  updateMediaSession: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: string }) => void) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  },
}));
vi.mock("@/lib/api", () => ({ api: { updateMediaSession } }));

import { useMediaSession } from "./use-media-session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = () => {
  useMediaSession();
  return null;
};

const press = (button: string) => listeners.get("media-session-button")?.({ payload: button });

describe("useMediaSession", () => {
  let root: Root;

  beforeEach(() => {
    listeners.clear();
    updateMediaSession.mockClear();
    useMusicStore.setState({
      playlists: [
        {
          id: "a",
          name: "a",
          items: [
            { id: "v1", title: "one" },
            { id: "v2", title: "two" },
          ],
        },
      ],
      activePlaylistId: "a",
      currentVideoId: "v1",
      currentIndex: 0,
      isPlaying: true,
      isShuffle: false,
      loopMode: "all",
      shuffleQueue: {},
      playHistory: {},
      playerInstance: null,
      hydrated: true,
    });
    root = createRoot(document.createElement("div"));
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("pushes the current track and play state to the backend", () => {
    expect(updateMediaSession).toHaveBeenLastCalledWith({
      videoId: "v1",
      title: "one",
      playing: true,
    });
    act(() => useMusicStore.setState({ isPlaying: false }));
    expect(updateMediaSession).toHaveBeenLastCalledWith({
      videoId: "v1",
      title: "one",
      playing: false,
    });
    act(() => useMusicStore.setState({ currentVideoId: null }));
    expect(updateMediaSession).toHaveBeenLastCalledWith({
      videoId: null,
      title: null,
      playing: false,
    });
  });

  it("runs the next / previous buttons through the store", () => {
    press("next");
    expect(useMusicStore.getState().currentVideoId).toBe("v2");
    press("previous");
    expect(useMusicStore.getState().currentVideoId).toBe("v1");
  });

  it("runs the play / pause buttons through the store", () => {
    press("pause");
    expect(useMusicStore.getState().isPlaying).toBe(false);
    press("play");
    expect(useMusicStore.getState().isPlaying).toBe(true);
  });

  it("ignores a button it does not know", () => {
    press("stop");
    expect(useMusicStore.getState().currentVideoId).toBe("v1");
  });

  it("stops listening on unmount", async () => {
    act(() => root.unmount());
    await Promise.resolve();
    expect(listeners.has("media-session-button")).toBe(false);
    root = createRoot(document.createElement("div"));
  });
});
