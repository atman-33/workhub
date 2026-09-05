import { useEffect, useState } from "react";
import { FileCode2, FolderOpen, Sparkles, Webhook } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { PluginView } from "@/lib/plugins";
import type { PluginDetails, PluginEntry } from "@/types";

/**
 * What a plugin actually puts into a session — its skills, agents, commands
 * and hooks.
 *
 * The Plugins tab answers "is my harness complete and current"; it never said
 * what any of these plugins *do*, which left the owner opening
 * `~/.claude/plugins/cache/...` by hand to find out. Everything here is read
 * from the installed copy (T-0234), so it describes the version a session is
 * running rather than what the marketplace clone happens to offer.
 *
 * Read-only by design: switching a plugin on or off stays on the card behind
 * this dialog, where the consequence is next to the thing it changes.
 */
export function PluginDetailsDialog({
  view,
  vaultPath,
  onClose,
}: {
  /** The plugin to describe; null closes the dialog. */
  view: PluginView | null;
  vaultPath: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<PluginDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!view) return;
    let stale = false;
    setDetails(null);
    setError(null);
    api
      .pluginDetails(vaultPath, view.name, view.marketplace, view.effective_scope)
      .then((d) => {
        if (!stale) setDetails(d);
      })
      .catch((e) => {
        if (!stale) setError(String(e));
      });
    // A second plugin opened before the first resolved must not overwrite it.
    return () => {
      stale = true;
    };
  }, [view, vaultPath]);

  return (
    <Dialog open={view !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {view?.name}
            {details?.version && (
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {details.version}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">
            {details?.description || view?.summary || "No description."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {!details && !error && <p className="text-xs text-muted-foreground">Loading…</p>}

        {details && !details.installed && (
          <p className="rounded border p-3 text-xs leading-relaxed text-muted-foreground">
            {view?.enabled
              ? "This plugin is switched on but not installed yet — Claude Code fetches it on the next launch, and its contents can only be read once it is on disk."
              : "Nothing is installed for this plugin on this machine, so there are no contents to read."}
          </p>
        )}

        {details?.installed && <Contents details={details} />}
      </DialogContent>
    </Dialog>
  );
}

function Contents({ details }: { details: PluginDetails }) {
  // Only the tabs the plugin actually has anything for. A plugin that ships
  // three skills and nothing else should not offer three empty tabs.
  const tabs = [
    { key: "skills", label: "Skills", count: details.skills.length },
    { key: "agents", label: "Agents", count: details.agents.length },
    { key: "commands", label: "Commands", count: details.commands.length },
    { key: "hooks", label: "Hooks", count: details.hooks.length },
  ].filter((t) => t.count > 0);

  if (tabs.length === 0) {
    return (
      <p className="rounded border p-3 text-xs leading-relaxed text-muted-foreground">
        This plugin ships no skills, agents, commands or hooks — whatever it
        contributes is not something that can be listed here.
      </p>
    );
  }

  return (
    <Tabs defaultValue={tabs[0].key} className="flex min-h-0 flex-1 flex-col gap-3">
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.key} value={t.key}>
            {t.label}
            <span className="ml-1.5 text-muted-foreground">· {t.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="skills" className="min-h-0 flex-1 overflow-y-auto">
        <EntryList entries={details.skills} icon={<Sparkles className="size-3.5" />} slash />
      </TabsContent>
      <TabsContent value="agents" className="min-h-0 flex-1 overflow-y-auto">
        <EntryList entries={details.agents} icon={<FileCode2 className="size-3.5" />} />
      </TabsContent>
      <TabsContent value="commands" className="min-h-0 flex-1 overflow-y-auto">
        <EntryList entries={details.commands} icon={<FileCode2 className="size-3.5" />} slash />
      </TabsContent>
      <TabsContent value="hooks" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {details.hooks.map((hook) => (
          <div key={hook.event} className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Webhook className="size-3.5 text-muted-foreground" />
              {hook.event}
            </div>
            {/* Commands verbatim: which script runs is the whole point, and
                `${CLAUDE_PLUGIN_ROOT}` is part of the answer. */}
            {hook.commands.map((command) => (
              <p
                key={command}
                className="break-all pl-5 font-mono text-[11px] leading-relaxed text-muted-foreground"
              >
                {command}
              </p>
            ))}
          </div>
        ))}
      </TabsContent>

      <p className="flex items-center gap-1.5 border-t pt-2 font-mono text-[10px] text-muted-foreground">
        <FolderOpen className="size-3 shrink-0" />
        <span className="break-all">{details.install_path}</span>
      </p>
    </Tabs>
  );
}

/** `slash` prefixes the name with `/`, the way skills and commands are invoked. */
function EntryList({
  entries,
  icon,
  slash = false,
}: {
  entries: PluginEntry[];
  icon: React.ReactNode;
  slash?: boolean;
}) {
  return (
    <div className="divide-y">
      {entries.map((entry) => (
        <div key={entry.path} className="flex items-start gap-2 py-2">
          <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium">
                {slash ? "/" : ""}
                {entry.name}
              </span>
              {entry.model && (
                <span className="font-mono text-[10px] text-muted-foreground">{entry.model}</span>
              )}
            </div>
            {entry.description && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {entry.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Opens the details dialog for a plugin card. */
export function PluginDetailsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onOpen}>
      Contents
    </Button>
  );
}
