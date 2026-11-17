// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMusicStore } from "@/stores/music";
import { useMediaSession } from "./use-media-session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (() => void) | null;

const Probe = () => {
  useMediaSession();
  return null;
};

describe("useMediaSession", () => {
  let handlers: Record<string, Handler>;
  let fakeSession: { playbackState: string; setActionHandler: (a: string, h: Handler) => void };
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    handlers = {};
    fakeSession = {
      playbackState: "none",
      setActionHandler: (action, handler) => {
        handlers[action] = handler;
      },
    };
    Object.defineProperty(navigator, "mediaSession", {
      value: fakeSession,
      configurable: true,
    });
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
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    Reflect.deleteProperty(navigator, "mediaSession");
  });

  it("registers previous / next handlers that drive the store", () => {
    handlers.nexttrack?.();
    expect(useMusicStore.getState().currentVideoId).toBe("v2");
    handlers.previoustrack?.();
    expect(useMusicStore.getState().currentVideoId).toBe("v1");
  });

  it("registers play / pause handlers", () => {
    handlers.pause?.();
    expect(useMusicStore.getState().isPlaying).toBe(false);
    handlers.play?.();
    expect(useMusicStore.getState().isPlaying).toBe(true);
  });

  it("mirrors the store's playing state into playbackState", () => {
    expect(fakeSession.playbackState).toBe("playing");
    act(() => useMusicStore.setState({ isPlaying: false }));
    expect(fakeSession.playbackState).toBe("paused");
    act(() => useMusicStore.setState({ currentVideoId: null, isPlaying: false }));
    expect(fakeSession.playbackState).toBe("none");
  });

  it("clears the handlers on unmount", () => {
    act(() => root.unmount());
    expect(handlers.nexttrack).toBeNull();
    expect(handlers.previoustrack).toBeNull();
    root = createRoot(container);
  });

  it("does nothing where the Media Session API is missing", () => {
    act(() => root.unmount());
    Reflect.deleteProperty(navigator, "mediaSession");
    root = createRoot(container);
    expect(() => act(() => root.render(<Probe />))).not.toThrow();
    vi.restoreAllMocks();
  });
});
