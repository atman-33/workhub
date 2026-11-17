import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { currentTrackTitle } from "@/lib/music/track-title";
import { useMusicStore } from "@/stores/music";

/** Event the backend emits when a system media button is pressed. */
const BUTTON_EVENT = "media-session-button";

const runButton = (button: unknown) => {
  const store = useMusicStore.getState();
  switch (button) {
    case "next":
      store.playNext();
      break;
    case "previous":
      store.playPrevious();
      break;
    case "play":
      store.resume();
      break;
    case "pause":
      store.pause();
      break;
  }
};

/**
 * Connects the music store to the system media controls (the Windows flyout
 * that opens on the volume / media keys).
 *
 * The backend owns the controls (`media_session.rs`): WebView2's own
 * integration is off, because it exposes the embedded YouTube player under the
 * iframe's session, whose previous / next buttons nothing in the page can
 * reach. This hook pushes what is playing to the backend and runs the buttons
 * it reports through the store, so shuffle history and loop mode behave
 * exactly as with the in-app buttons.
 *
 * Mount once at the app shell: the player stays alive on every tab, so the
 * controls have to work there too.
 */
export const useMediaSession = () => {
  const isPlaying = useMusicStore((state) => state.isPlaying);
  const videoId = useMusicStore((state) => state.currentVideoId);
  const title = useMusicStore((state) =>
    currentTrackTitle(
      state.playlists.find((playlist) => playlist.id === state.activePlaylistId),
      state.currentVideoId,
    ),
  );

  useEffect(() => {
    const unlisten = listen<string>(BUTTON_EVENT, (event) => runButton(event.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    api.updateMediaSession({ videoId, title, playing: isPlaying }).catch((error: unknown) => {
      console.error("media session update failed", error);
    });
  }, [videoId, title, isPlaying]);
};
