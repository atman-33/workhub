import { useCallback, useEffect, useState } from "react";
import { Inbox, Lightbulb, RefreshCw } from "lucide-react";
import { OpenInObsidianButton } from "@/components/open-in-obsidian-button";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Markdown } from "@/components/ui/markdown";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { InboxNote } from "@/types";

/**
 * The Inbox tab (design note "Inbox — 受信ノート処理導線", phase 1).
 *
 * Read-only on purpose. Two things were invisible before this tab existed: the
 * notes sitting unfiled in the vault's `inbox/`, and the filing proposals the
 * tidy agent parked in `_ai/memory/tidy-pending.json` when it could not decide
 * where one belonged. Showing both is the whole feature — moving, archiving
 * and ingesting come in phase 2, and until then filing still happens in
 * Obsidian, which is why every row offers a jump there.
 *
 * The listing is reloaded whenever the tab becomes active rather than watched:
 * `inbox/` changes at human speed, and a watcher would be one more thing to
 * keep in sync with the tidy routine for no visible gain.
 */

interface Props {
  configVersion: number;
  active: boolean;
}

function formatDate(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatAge(days: number): string {
  if (days <= 0) return "today";
  return `${days}d`;
}

export function InboxView({ configVersion, active }: Props) {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [notes, setNotes] = useState<InboxNote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const cfg = await api.getConfig();
      setVaultPath(cfg.settings.vault_path?.trim() || null);
    })();
  }, [configVersion]);

  const reload = useCallback(async () => {
    if (!vaultPath) {
      setNotes([]);
      return;
    }
    setLoading(true);
    try {
      const list = await api.listInboxNotes(vaultPath);
      setNotes(list);
      setError(null);
      // Keep the current selection when the note survived the reload, so a
      // refresh does not throw the reader out of what they were reading.
      setSelected((prev) =>
        prev && list.some((n) => n.path === prev) ? prev : (list[0]?.path ?? null),
      );
    } catch (e) {
      setError(String(e));
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [vaultPath]);

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload]);

  useEffect(() => {
    if (!selected) {
      setBody("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const text = await api.readInboxNote(selected);
        if (!cancelled) setBody(text);
      } catch (e) {
        if (!cancelled) setBody(`> ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const current = notes.find((n) => n.path === selected) ?? null;

  if (!vaultPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Set a vault path in Settings to see the notes waiting in its inbox.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Inbox className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Inbox</span>
        <span className="text-[11px] text-muted-foreground">
          {notes.length} note{notes.length === 1 ? "" : "s"}
          {notes.some((n) => n.pending) &&
            ` · ${notes.filter((n) => n.pending).length} with a proposal`}
        </span>
        <Hint label="Reload" disabled={loading}>
          <Button
            size="icon-xs"
            variant="ghost"
            className="ml-auto"
            disabled={loading}
            onClick={() => void reload()}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </Hint>
      </div>
      {error && (
        <div className="border-b bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="list" defaultSize="30%" minSize="18%" className="min-h-0">
          <div className="h-full overflow-y-auto">
            {notes.length === 0 && !loading && (
              <p className="p-4 text-xs text-muted-foreground">
                Nothing is waiting in the inbox.
              </p>
            )}
            {notes.map((note) => (
              <button
                key={note.path}
                onClick={() => setSelected(note.path)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left transition-colors",
                  note.path === selected ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <Hint label={note.rel_path}>
                  <span className="w-full truncate text-xs font-medium">{note.name}</span>
                </Hint>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{formatDate(note.modified)}</span>
                  <Hint
                    label={note.stale ? "Old enough for the vault-tidy routine to act on" : undefined}
                  >
                    <span
                      className={cn(
                        note.stale && "font-medium text-amber-600 dark:text-amber-500",
                      )}
                    >
                      {formatAge(note.age_days)}
                      {note.pending && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 text-primary">
                          <Lightbulb className="size-2.5" />
                          proposal
                        </span>
                      )}
                    </span>
                  </Hint>
                </span>
              </button>
            ))}
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="preview" defaultSize="70%" minSize="30%" className="min-h-0">
          <div className="flex h-full flex-col">
            {current ? (
              <>
                <div className="flex items-center gap-2 border-b px-3 py-1.5">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {current.rel_path}
                  </span>
                  <OpenInObsidianButton
                    className="ml-auto"
                    onOpen={() => api.openInObsidian(current.path)}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  <Markdown>{body}</Markdown>
                </div>
                {current.pending && (
                  <div className="border-t bg-muted/30 px-4 py-3 text-xs">
                    <p className="mb-1 flex items-center gap-1.5 font-medium">
                      <Lightbulb className="size-3.5 text-primary" />
                      Vault tidy deferred this note
                    </p>
                    {current.pending.proposal && (
                      <p className="text-muted-foreground">
                        <span className="text-foreground">Proposal:</span>{" "}
                        {current.pending.proposal}
                      </p>
                    )}
                    {current.pending.reason && (
                      <p className="text-muted-foreground">
                        <span className="text-foreground">Reason:</span>{" "}
                        {current.pending.reason}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Filing is still done in Obsidian — acting on a proposal from here
                      comes later.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Select a note to preview it.
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
