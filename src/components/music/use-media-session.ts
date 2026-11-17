import { useEffect } from "react";
import { useMusicStore } from "@/stores/music";

type SessionAction = "play" | "pause" | "previoustrack" | "nexttrack";

/**
 * Connects the music store to the OS media controls (the Windows flyout that
 * appears on the volume / media keys).
 *
 * WebView2 already publishes the embedded YouTube player to the system media
 * transport controls, so title and artwork show up on their own, but the
 * previous / next buttons stay disabled until a page registers
 * `previoustrack` / `nexttrack` handlers. The handlers call the store, so
 * shuffle history and loop mode behave exactly as the in-app buttons.
 *
 * Mount once at the app shell: the player stays alive on every tab, so the
 * controls have to work there too.
 */
export const useMediaSession = () => {
  const isPlaying = useMusicStore((state) => state.isPlaying);
  const hasTrack = useMusicStore((state) => state.currentVideoId !== null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: Record<SessionAction, () => void> = {
      play: () => useMusicStore.getState().resume(),
      pause: () => useMusicStore.getState().pause(),
      previoustrack: () => useMusicStore.getState().playPrevious(),
      nexttrack: () => useMusicStore.getState().playNext(),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action as SessionAction, handler);
      } catch {
        // An action this engine does not support: the rest still register.
      }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          session.setActionHandler(action as SessionAction, null);
        } catch {
          // Nothing to undo.
        }
      }
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = !hasTrack ? "none" : isPlaying ? "playing" : "paused";
  }, [isPlaying, hasTrack]);
};
