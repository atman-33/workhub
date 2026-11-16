import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useT } from "@/lib/i18n";
import { type MatchRange, searchPlaylists } from "@/lib/music/item-search";
import { useMusicStore } from "@/stores/music";

/** Hits shown at most; more are summarised as a count so the list stays cheap to render. */
export const SEARCH_RESULT_LIMIT = 50;

/** Renders a title with the matched ranges in bold. */
function HighlightedTitle({ title, ranges }: { title: string; ranges: MatchRange[] }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      parts.push(title.slice(cursor, start));
    }
    parts.push(
      <b key={start} className="font-bold text-foreground">
        {title.slice(start, end)}
      </b>,
    );
    cursor = end;
  }
  if (cursor < title.length) {
    parts.push(title.slice(cursor));
  }
  return <span className="min-w-0 flex-1 truncate">{parts}</span>;
}

/**
 * Command-palette style search over every playlist's track titles (T-1271).
 * Picking a result switches to its playlist and plays it; the track list
 * underneath is left alone.
 */
export function TrackSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const playlists = useMusicStore((state) => state.playlists);
  const playTrackInPlaylist = useMusicStore((state) => state.playTrackInPlaylist);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { groups, omitted } = useMemo(
    () => searchPlaylists(playlists, query, SEARCH_RESULT_LIMIT),
    [playlists, query],
  );

  // A closed dialog's content stays mounted, so the input is not focused again
  // by Radix on a second open; do it here.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    // The search is never kept: reopening starts from an empty box.
    if (!next) setQuery("");
    onOpenChange(next);
  };

  const hasQuery = query.trim().length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      shouldFilter={false}
      title={t("music.search.title")}
      description={t("music.search.description")}
      showCloseButton={false}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder={t("music.search.placeholder")}
      />
      <CommandList>
        {hasQuery && <CommandEmpty>{t("music.search.empty")}</CommandEmpty>}
        {groups.map(({ playlist, hits }) => (
          <CommandGroup key={playlist.id} heading={playlist.name}>
            {hits.map(({ item, ranges }) => (
              <CommandItem
                key={item.id}
                value={`${playlist.id}:${item.id}`}
                onSelect={() => {
                  playTrackInPlaylist(playlist.id, item.id);
                  handleOpenChange(false);
                }}
              >
                <HighlightedTitle title={item.title ?? ""} ranges={ranges} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {omitted > 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("music.search.omitted", { count: omitted })}
          </p>
        )}
      </CommandList>
    </CommandDialog>
  );
}
