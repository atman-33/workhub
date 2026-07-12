import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { extractVideoId } from "@/lib/music/playlist-helpers";
import { useMusicStore } from "@/stores/music";

export function AddUrlForm() {
  const [inputUrl, setInputUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addToPlaylist = useMusicStore((state) => state.addToPlaylist);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!inputUrl.trim() || isLoading) {
      if (!inputUrl.trim()) {
        setError("Please enter a YouTube URL.");
      }
      return;
    }

    const videoId = extractVideoId(inputUrl);
    if (!videoId) {
      setError("Please enter a valid YouTube URL.");
      return;
    }

    setIsLoading(true);
    let title: string;
    try {
      title = await api.fetchYoutubeTitle(videoId);
    } catch {
      // oEmbed lookup failed (offline, embed-disabled, ...): fall back to the id.
      title = `Video ${videoId.substring(0, 5)}`;
    }
    setIsLoading(false);

    if (addToPlaylist({ id: videoId, title })) {
      setInputUrl("");
    } else {
      setError("This video is already in the playlist.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type="text"
            value={inputUrl}
            onChange={(e) => {
              setInputUrl(e.target.value);
              setError(null);
            }}
            placeholder="Enter YouTube URL"
            className="h-8 pr-8 text-xs"
            disabled={isLoading}
            aria-invalid={error ? "true" : "false"}
          />
          {inputUrl && (
            <button
              type="button"
              onClick={() => {
                setInputUrl("");
                setError(null);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={isLoading}
              aria-label="Clear input"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={isLoading}>
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
