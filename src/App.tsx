import { useCallback, useEffect, useState } from "react";
import { GitBranch, ListTodo, Music, Settings as SettingsIcon } from "lucide-react";
import { MusicView } from "@/components/music/MusicView";
import { ReposView } from "@/components/ReposView";
import { SettingsDialog } from "@/components/SettingsDialog";
import { TasksView } from "@/components/TasksView";
import { UpdateBanner } from "@/components/UpdateBanner";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Settings, UpdateInfo } from "@/types";

type Tab = "tasks" | "repos" | "music";

const TABS: { key: Tab; label: string; icon: typeof ListTodo }[] = [
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "repos", label: "Repos", icon: GitBranch },
  { key: "music", label: "Music", icon: Music },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  // Bumped after every settings save; views reload their config when it changes.
  const [configVersion, setConfigVersion] = useState(0);

  useEffect(() => {
    void (async () => {
      const cfg = await api.getConfig();
      setSettings(cfg.settings);
      setVersion(await api.appVersion());
      if (cfg.settings.check_updates) {
        setUpdate(await api.checkUpdate());
      }
    })();
  }, []);

  const saveSettings = useCallback(async (next: Settings) => {
    // Merge into the latest on-disk config so we never clobber projects/presets
    // persisted by the views after our initial load.
    const cfg = await api.getConfig();
    await api.saveConfig({ ...cfg, settings: next });
    setSettings(next);
    setConfigVersion((v) => v + 1);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col">
        {update && (
          <UpdateBanner update={update} currentVersion={version} onDismiss={() => setUpdate(null)} />
        )}
        <nav className="flex items-center gap-1 border-b bg-muted/30 px-3 py-1.5">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">v{version}</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon className="size-4" />
          </Button>
        </nav>
        <div className="min-h-0 flex-1">
          <div className={cn("h-full", tab !== "tasks" && "hidden")}>
            <TasksView
              configVersion={configVersion}
              onSettingsChange={(s) => setSettings(s)}
            />
          </div>
          <div className={cn("h-full", tab !== "repos" && "hidden")}>
            <ReposView configVersion={configVersion} />
          </div>
          <div className={cn("h-full", tab !== "music" && "hidden")}>
            <MusicView configVersion={configVersion} />
          </div>
        </div>
        {settings && (
          <SettingsDialog
            open={showSettings}
            settings={settings}
            onClose={() => setShowSettings(false)}
            onSave={(s) => void saveSettings(s)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
