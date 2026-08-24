import type { YouTubePlayerLike } from "@/stores/music/types";

export interface YouTubePlayerEvent {
  target: YouTubePlayerLike;
  data: number;
}

export interface YouTubePlayerOptions {
  events: {
    onReady: (event: YouTubePlayerEvent) => void;
    onStateChange: (event: YouTubePlayerEvent) => void;
  };
}

export interface YouTubeApi {
  Player: new (element: string | HTMLElement, options: YouTubePlayerOptions) => YouTubePlayerLike;
  PlayerState: {
    ENDED: number;
  };
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: YouTubeApi;
  }
}

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<YouTubeApi> | null = null;

/**
 * Loads the YouTube IFrame API once and resolves with it.
 *
 * The API only ever calls the single global `onYouTubeIframeAPIReady`, so every
 * player in the app has to come through here — the music player and the
 * off-screen import player would otherwise overwrite each other's callback and
 * one of them would never be created.
 */
export const loadYouTubeIframeApi = (): Promise<YouTubeApi> => {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (apiPromise) {
    return apiPromise;
  }

  apiPromise = new Promise<YouTubeApi>((resolve) => {
    window.onYouTubeIframeAPIReady = () => {
      resolve(window.YT as YouTubeApi);
    };
    if (!document.querySelector(`script[src="${IFRAME_API_SRC}"]`)) {
      const tag = document.createElement("script");
      tag.src = IFRAME_API_SRC;
      document.head.appendChild(tag);
    }
  });

  return apiPromise;
};
