import { useCallback, useEffect, useState } from "react";
import { GitBranch, ListTodo, Settings2 } from "lucide-react";
import { ReposView } from "@/components/ReposView";
import { SettingsDialog } from "@/components/SettingsDialog";
import { TasksView } from "@/components/TasksView";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Settings } from "@/types";

type Tab = "tasks" | "repos";

const TABS: { key: Tab; label: string; icon: typeof ListTodo }[] = [
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "repos", label: "Repos", icon: GitBranch },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  // Bumped after every settings save; views reload their config when it changes.
  const [configVersion, setConfigVersion] = useState(0);

  useEffect(() => {
    void api.getConfig().then((cfg) => setSettings(cfg.settings));
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
    <div className="flex h-screen flex-col">
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
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          onClick={() => setShowSettings(true)}
        >
          <Settings2 className="size-4" />
        </Button>
      </nav>
      <div className="min-h-0 flex-1">
        <div className={cn("h-full", tab !== "tasks" && "hidden")}>
          <TasksView configVersion={configVersion} />
        </div>
        <div className={cn("h-full", tab !== "repos" && "hidden")}>
          <ReposView configVersion={configVersion} />
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
  );
}
