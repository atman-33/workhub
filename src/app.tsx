import { useCallback, useEffect, useState } from "react";
import {
  CircleHelp,
  FolderOpen,
  GitBranch,
  ListTodo,
  Mic,
  Music,
  Settings as SettingsIcon,
  Timer,
} from "lucide-react";
import { HelpView } from "@/components/help-view";
import { MusicView } from "@/components/music/music-view";
import { ReposView } from "@/components/repos-view";
import { SettingsDialog } from "@/components/settings-dialog";
import { TasksView } from "@/components/tasks-view";
import { TimerView } from "@/components/timer/timer-view";
import { UpdateBanner } from "@/components/update-banner";
import { VoiceView } from "@/components/voice-view";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useTidyNotifications } from "@/lib/use-tidy-notifications";
import { cn } from "@/lib/utils";
import type { Settings, UpdateInfo } from "@/types";

type Tab = "tasks" | "repos" | "music" | "timer" | "voice" | "help";

const TABS: { key: Tab; label: string; icon: typeof ListTodo }[] = [
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "repos", label: "Repos", icon: GitBranch },
  { key: "music", label: "Music", icon: Music },
  { key: "timer", label: "Timer", icon: Timer },
  { key: "voice", label: "Voice", icon: Mic },
  { key: "help", label: "Help", icon: CircleHelp },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  // Bumped after every settings save; views reload their config when it changes.
  const [configVersion, setConfigVersion] = useState(0);
  useTidyNotifications();

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
          {settings?.vault_path && (
            <span
              className="ml-auto flex max-w-48 items-center gap-1 truncate text-[11px] text-muted-foreground"
              title={settings.vault_path}
            >
              <FolderOpen className="size-3 shrink-0" />
              {settings.vault_path}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">v{version}</span>
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
            <ReposView configVersion={configVersion} active={tab === "repos"} />
          </div>
          <div className={cn("h-full", tab !== "music" && "hidden")}>
            <MusicView configVersion={configVersion} />
          </div>
          <div className={cn("h-full", tab !== "timer" && "hidden")}>
            <TimerView />
          </div>
          <div className={cn("h-full", tab !== "voice" && "hidden")}>
            <VoiceView />
          </div>
          <div className={cn("h-full", tab !== "help" && "hidden")}>
            <HelpView />
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
