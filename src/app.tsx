import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleHelp,
  ClipboardList,
  Drama,
  FolderOpen,
  GitBranch,
  CalendarRange,
  Inbox,
  ListTodo,
  Mic,
  Music,
  Network,
  FolderKanban,
  Pencil,
  Settings as SettingsIcon,
  Timer,
} from "lucide-react";
import { ClipsView } from "@/components/clips-view";
import { HelpView } from "@/components/help-view";
import { InboxView } from "@/components/inbox-view";
import { InkView } from "@/components/ink-view";
import { MemorySetupBanner } from "@/components/memory-setup-banner";
import { MindmapView } from "@/components/mindmap/mindmap-view";
import { MusicView } from "@/components/music/music-view";
import { PersonaView } from "@/components/persona-view";
import { NavMusicControl } from "@/components/music/nav-music-control";
import { ProjectsView, type ProjectTarget } from "@/components/projects/projects-view";
import { ReposView } from "@/components/repos-view";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { SettingsDialog } from "@/components/settings-dialog";
import { TasksView } from "@/components/tasks-view";
import {
  TemplateAutoAppliedBanner,
  TemplateUpdateBanner,
} from "@/components/template-update-banner";
import { TimerView } from "@/components/timer/timer-view";
import { UpdateBanner } from "@/components/update-banner";
import { VoiceView } from "@/components/voice-view";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useRecurringTasks } from "@/lib/use-recurring-tasks";
import { useTidyNotifications } from "@/lib/use-tidy-notifications";
import { cn } from "@/lib/utils";
import type { Settings, TemplateDiff, UpdateInfo } from "@/types";

type Tab =
  | "tasks"
  | "projects"
  | "inbox"
  | "repos"
  | "schedule"
  | "mindmap"
  | "music"
  | "timer"
  | "voice"
  | "clips"
  | "ink"
  | "persona"
  | "help";

// `persona` is always shown. When the plugin ships no characters the tab
// explains what is missing and hands over the prompt that installs it — a tab
// that vanishes teaches the owner nothing about why (T-0215).
const TABS: { key: Tab; label: string; icon: typeof ListTodo }[] = [
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "repos", label: "Repos", icon: GitBranch },
  { key: "schedule", label: "Schedule", icon: CalendarRange },
  { key: "mindmap", label: "Mindmap", icon: Network },
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "music", label: "Music", icon: Music },
  { key: "timer", label: "Timer", icon: Timer },
  { key: "voice", label: "Voice", icon: Mic },
  { key: "clips", label: "Clips", icon: ClipboardList },
  { key: "ink", label: "Ink", icon: Pencil },
  { key: "persona", label: "Persona", icon: Drama },
  { key: "help", label: "Help", icon: CircleHelp },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [templateDiff, setTemplateDiff] = useState<TemplateDiff | null>(null);
  // Paths applied silently on startup (T-0196) — shown as a dismissible
  // note so a template change is never completely invisible.
  const [autoApplied, setAutoApplied] = useState<string[]>([]);
  const [memorySetupNeeded, setMemorySetupNeeded] = useState(false);
  // Bumped after every settings save; views reload their config when it changes.
  const [configVersion, setConfigVersion] = useState(0);
  // Bumped when the Repos view adds, removes or renames a repository. Kept
  // separate from configVersion so the Repos view does not reload (and race
  // its own just-persisted config) as a result of its own edit.
  const [projectsVersion, setProjectsVersion] = useState(0);
  // Bumped when the Projects view creates, archives or restores a vault
  // project. The `projects-changed` watcher event covers the same ground for
  // writers outside the app (Obsidian, an agent), but the app's own actions
  // must not depend on an event arriving — this is the deterministic half.
  const [vaultProjectsVersion, setVaultProjectsVersion] = useState(0);
  // Cross-tab focus: the Projects tab hands another tab a project slug (or a
  // repository path) to select. Carried with a counter rather than the value
  // alone so that asking for the *same* project twice still re-focuses it —
  // the receiving view may have been navigated away from in between.
  const [focus, setFocus] = useState<{ tab: Tab; value: string; n: number } | null>(null);
  const focusOn = useCallback((target: ProjectTarget, value: string) => {
    setFocus((prev) => ({ tab: target, value, n: (prev?.n ?? 0) + 1 }));
    setTab(target);
  }, []);
  const focusFor = (t: Tab) =>
    focus && focus.tab === t ? { value: focus.value, n: focus.n } : undefined;
  // When the tab strip is scrolled (narrow windows), a tab selected from
  // elsewhere — the Projects view's cross-tab focus, the music control — can sit
  // outside the visible slice. Pull it back into view on every change.
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  useTidyNotifications();
  // Recurring task rules (T-0110): checked on start and every few minutes, so a
  // machine booted after a rule's time still gets that occurrence's task.
  useRecurringTasks(configVersion);

  const checkTemplate = useCallback(async (vaultPath: string, autoApply = false) => {
    try {
      // Updates that cannot lose user edits are applied first and silently
      // (T-0196): asking about them was pure friction. Whatever the check
      // reports afterwards is what genuinely needs a decision.
      if (autoApply) {
        const applied = await api.applySafeTemplateUpdates(vaultPath);
        setAutoApplied(applied);
      }
      const diff = await api.checkVaultTemplate(vaultPath);
      setTemplateDiff(diff);
    } catch {
      // Never block startup on a template-check failure.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const cfg = await api.getConfig();
      setSettings(cfg.settings);
      setVersion(await api.appVersion());
      if (cfg.settings.check_updates) {
        setUpdate(await api.checkUpdate());
      }
      if (cfg.settings.vault_path && cfg.settings.check_template_updates) {
        await checkTemplate(
          cfg.settings.vault_path,
          cfg.settings.auto_apply_template_updates,
        );
      }
      if (
        cfg.settings.vault_path &&
        cfg.settings.check_memory_setup &&
        (cfg.settings.memory_claude_code || cfg.settings.memory_opencode)
      ) {
        try {
          setMemorySetupNeeded(!(await api.memorySetupOk()));
        } catch {
          // Never block startup on the memory-setup check.
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = useCallback(async (next: Settings) => {
    // Merge into the latest on-disk config so we never clobber projects/presets
    // persisted by the views after our initial load.
    const cfg = await api.getConfig();
    // Render what took effect, not what was sent: switching to a vault that
    // already carries its own settings adopts those (T-0206).
    const saved = await api.saveConfig({ ...cfg, settings: next });
    setSettings(saved.settings);
    setConfigVersion((v) => v + 1);
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col overflow-hidden">
        {update && (
          <UpdateBanner update={update} currentVersion={version} onDismiss={() => setUpdate(null)} />
        )}
        {memorySetupNeeded && settings && (
          <MemorySetupBanner
            onDismiss={() => setMemorySetupNeeded(false)}
            onDisable={() => {
              setMemorySetupNeeded(false);
              void saveSettings({ ...settings, check_memory_setup: false });
            }}
          />
        )}
        {autoApplied.length > 0 && (
          <TemplateAutoAppliedBanner
            paths={autoApplied}
            onDismiss={() => setAutoApplied([])}
          />
        )}
        {templateDiff && settings?.vault_path && (
          <TemplateUpdateBanner
            diff={templateDiff}
            vaultPath={settings.vault_path}
            onDismiss={() => setTemplateDiff(null)}
            onApplied={() => void checkTemplate(settings.vault_path as string)}
          />
        )}
        <nav className="flex items-center gap-1 border-b bg-muted/30 px-3 py-1.5">
          {/* The tab strip degrades with the window width (T-0207): all
              thirteen tabs plus the status cluster need ~1470px, well past the 720px
              minimum window size. Labels collapse below `xl` (the tooltip then
              names the tab), the active tab keeps its label so the current
              position stays readable, and this container scrolls as the last
              resort at the narrowest widths. */}
          <div
            className="nav-tabs-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            // The strip's scrollbar is hidden, and a plain wheel only produces a
            // vertical delta — translate it so the wheel still reaches the tabs
            // that scrolled out of sight.
            onWheel={(e) => {
              if (e.deltaX !== 0) return;
              e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {TABS.map(({ key, label, icon: Icon }) => (
              <Hint key={key} label={label}>
                <button
                  ref={tab === key ? activeTabRef : undefined}
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    tab === key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className={cn(tab === key ? "inline" : "hidden xl:inline")}>
                    {label}
                  </span>
                </button>
              </Hint>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <NavMusicControl onOpenMusic={() => setTab("music")} />
            {settings?.vault_path && (
              <Hint label={settings.vault_path}>
                <span className="hidden max-w-48 items-center gap-1 truncate text-[11px] text-muted-foreground lg:flex">
                  <FolderOpen className="size-3 shrink-0" />
                  {settings.vault_path}
                </span>
              </Hint>
            )}
            <span className="hidden text-[11px] text-muted-foreground md:inline">
              v{version}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setShowSettings(true)}
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>
        </nav>
        <div className="min-h-0 flex-1">
          <div className={cn("h-full", tab !== "tasks" && "hidden")}>
            <TasksView
              configVersion={configVersion}
              projectsVersion={projectsVersion}
              focus={focusFor("tasks")}
              onSettingsChange={(s) => setSettings(s)}
            />
          </div>
          <div className={cn("h-full", tab !== "projects" && "hidden")}>
            <ProjectsView
              configVersion={configVersion}
              active={tab === "projects"}
              onNavigate={focusOn}
              onProjectsChange={() => setVaultProjectsVersion((v) => v + 1)}
            />
          </div>
          <div className={cn("h-full", tab !== "repos" && "hidden")}>
            <ReposView
              configVersion={configVersion}
              active={tab === "repos"}
              focus={focusFor("repos")}
              onProjectsChange={() => setProjectsVersion((v) => v + 1)}
            />
          </div>
          <div className={cn("h-full", tab !== "schedule" && "hidden")}>
            <ScheduleView
              configVersion={configVersion}
              projectsVersion={vaultProjectsVersion}
              focus={focusFor("schedule")}
            />
          </div>
          <div className={cn("h-full", tab !== "mindmap" && "hidden")}>
            <MindmapView
              configVersion={configVersion}
              projectsVersion={vaultProjectsVersion}
              focus={focusFor("mindmap")}
            />
          </div>
          <div className={cn("h-full", tab !== "inbox" && "hidden")}>
            <InboxView configVersion={configVersion} active={tab === "inbox"} />
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
          <div className={cn("h-full", tab !== "clips" && "hidden")}>
            <ClipsView configVersion={configVersion} />
          </div>
          <div className={cn("h-full", tab !== "ink" && "hidden")}>
            <InkView configVersion={configVersion} />
          </div>
          <div className={cn("h-full", tab !== "persona" && "hidden")}>
            <PersonaView active={tab === "persona"} />
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
            onSave={saveSettings}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
