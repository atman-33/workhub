import { Pause, Play } from "lucide-react";
import { currentTrackTitle } from "@/lib/music/track-title";
import { useMusicStore } from "@/stores/music";

interface Props {
  /** Switches the app shell to the Music tab. */
  onOpenMusic: () => void;
}

/**
 * Compact play/pause control shown in the app's navigation bar.
 *
 * The music player stays mounted on every tab, so playback continues after the
 * user navigates away; without this control, stopping it means going back to
 * the Music tab first. Renders nothing until a video is loaded, so the nav bar
 * is untouched for anyone not using the player.
 */
export function NavMusicControl({ onOpenMusic }: Props) {
  const isPlaying = useMusicStore((state) => state.isPlaying);
  const currentVideoId = useMusicStore((state) => state.currentVideoId);
  const pause = useMusicStore((state) => state.pause);
  const resume = useMusicStore((state) => state.resume);
  const activePlaylist = useMusicStore((state) =>
    state.playlists.find((playlist) => playlist.id === state.activePlaylistId),
  );

  const title = currentTrackTitle(activePlaylist, currentVideoId);
  if (!title) return null;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        onClick={() => (isPlaying ? pause() : resume())}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        title={isPlaying ? "Pause music" : "Resume music"}
      >
        {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        <span className="sr-only">{isPlaying ? "Pause music" : "Resume music"}</span>
      </button>
      <button
        onClick={onOpenMusic}
        className="max-w-40 truncate text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        title={`${title} — open the Music tab`}
      >
        {title}
      </button>
    </div>
  );
}
