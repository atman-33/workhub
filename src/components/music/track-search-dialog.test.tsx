// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Playlist } from "@/lib/music/types";
import { useMusicStore } from "@/stores/music";
import { TrackSearchDialog } from "./track-search-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// cmdk and Radix expect these browser APIs.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

const playlist = (id: string, titles: string[]): Playlist => ({
  id,
  name: `list ${id}`,
  items: titles.map((title, i) => ({ id: `${id}${i}`, title })),
});

describe("TrackSearchDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onOpenChange: Mock<(open: boolean) => void>;

  const render = (open = true) =>
    act(() => root.render(<TrackSearchDialog open={open} onOpenChange={onOpenChange} />));

  const input = () => document.querySelector<HTMLInputElement>("[cmdk-input]");
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[cmdk-item]"));

  const type = (value: string) => {
    const el = input();
    if (!el) throw new Error("no input");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const key = (k: string) =>
    act(() => {
      input()?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useMusicStore.setState({
      playlists: [
        playlist("a", ["Hello World", "Other song"]),
        playlist("b", ["hello again", "Nothing"]),
      ],
      activePlaylistId: "a",
      currentVideoId: null,
      currentIndex: null,
      isShuffle: false,
      shuffleQueue: {},
      playHistory: {},
      playerInstance: null,
      hydrated: true,
    });
    onOpenChange = vi.fn<(open: boolean) => void>();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  it("shows hits from every playlist, grouped, with the match in bold", () => {
    render();
    type("hello");
    expect(rows().map((r) => r.textContent)).toEqual(["Hello World", "hello again"]);
    const headings = Array.from(document.querySelectorAll("[cmdk-group-heading]")).map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(["list a", "list b"]);
    expect(rows()[0].querySelector("b")?.textContent).toBe("Hello");
  });

  it("says so when nothing matches", () => {
    render();
    type("zzz");
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("[cmdk-empty]")).not.toBeNull();
  });

  it("plays the clicked track in its playlist and closes", () => {
    render();
    type("hello");
    act(() => rows()[1].click());
    const state = useMusicStore.getState();
    expect(state.activePlaylistId).toBe("b");
    expect(state.currentVideoId).toBe("b0");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("selects with the arrow keys and plays on Enter", () => {
    render();
    type("hello");
    expect(rows()[0].getAttribute("data-selected")).toBe("true");
    key("ArrowDown");
    expect(rows()[1].getAttribute("data-selected")).toBe("true");
    key("Enter");
    expect(useMusicStore.getState().currentVideoId).toBe("b0");
  });
});
