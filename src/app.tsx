import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronsRight,
  CircleHelp,
  BookOpen,
  ClipboardList,
  Drama,
  FolderOpen,
  GitBranch,
  CalendarRange,
  Inbox,
  ListTodo,
  Mic,
  Minus,
  Music,
  Network,
  FolderKanban,
  Pencil,
  Plus,
  Puzzle,
  RotateCcw,
  Settings as SettingsIcon,
  Timer,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ClipsView } from "@/components/clips-view";
import { DocsView } from "@/components/docs/docs-view";
import { ErrorBoundary } from "@/components/error-boundary";
import { HelpView } from "@/components/help-view";
import { InboxView } from "@/components/inbox-view";
import { InkView } from "@/components/ink-view";
import { MemorySetupBanner } from "@/components/memory-setup-banner";
import { MindmapView } from "@/components/mindmap/mindmap-view";
import { MusicView } from "@/components/music/music-view";
import { PersonaView } from "@/components/persona-view";
import { PluginsView } from "@/components/plugins-view";
import { NavListenerButton } from "@/components/nav-listener-button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import {
  APP_ZOOM,
  APP_ZOOM_KEY,
  isTauri,
  normalizeAppZoom,
  parseAppZoom,
} from "@/lib/app-zoom";
import { useRecurringTasks } from "@/lib/use-recurring-tasks";
import { useTidyNotifications } from "@/lib/use-tidy-notifications";
import { cn } from "@/lib/utils";
import type { Settings, TemplateDiff, UpdateInfo } from "@/types";

/**
 * One tab's slot in the shell.
 *
 * Every tab is mounted at once and the inactive ones are hidden with CSS,
 * so that switching back to a tab does not throw away its scroll position,
 * its unsaved edits or its watchers. The cost is that a hidden tab still
 * renders — and before this had a boundary, an exception in one of them
 * unmounted the entire app, blanking the window over a view the user could
 * not even see (T-0254). The boundary is inside the hiding wrapper so a
 * failed tab reports itself where that tab lives, and the others carry on.
 */
function TabPanel({ id, tab, children }: { id: Tab; tab: Tab; children: ReactNode }) {
  return (
    <div className={cn("h-full", tab !== id && "hidden")}>
      <ErrorBoundary label={id}>{children}</ErrorBoundary>
    </div>
  );
}

type Tab =
  | "tasks"
  | "projects"
  | "inbox"
  | "repos"
  | "schedule"
  | "mindmap"
  | "docs"
  | "music"
  | "timer"
  | "voice"
  | "clips"
  | "ink"
  | "persona"
  | "plugins"
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
  { key: "docs", label: "Docs", icon: BookOpen },
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "music", label: "Music", icon: Music },
  { key: "timer", label: "Timer", icon: Timer },
  { key: "voice", label: "Voice", icon: Mic },
  { key: "clips", label: "Clips", icon: ClipboardList },
  { key: "ink", label: "Ink", icon: Pencil },
  { key: "persona", label: "Persona", icon: Drama },
  { key: "plugins", label: "Plugins", icon: Puzzle },
  { key: "help", label: "Help", icon: CircleHelp },
];

/**
 * App-wide zoom control (T-0346): a compact `%` readout in the nav cluster
 * whose popover holds −/+ buttons, a slider and a reset. The zoom itself is
 * the native WebView zoom (`getCurrentWebview().setZoom`), so px-sized
 * layouts like the schedule bars scale too — unlike CSS-only approaches.
 * Shortcuts: Ctrl+= / Ctrl+- / Ctrl+0, the way a browser does it.
 */
function ZoomControl() {
  const [zoom, setZoomState] = useState(() => {
    try {
      return parseAppZoom(localStorage.getItem(APP_ZOOM_KEY));
    } catch {
      return APP_ZOOM.initial;
    }
  });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const apply = useCallback((next: number) => {
    const value = normalizeAppZoom(next);
    setZoomState(value);
    try {
      localStorage.setItem(APP_ZOOM_KEY, String(value));
    } catch {
      // Persistence is a nicety; never break zooming over storage.
    }
    // The native factor resets to 100% on every launch, so the remembered
    // value is re-applied on startup (see the effect below).
    if (isTauri()) void getCurrentWebview().setZoom(value).catch(console.error);
  }, []);

  useEffect(() => {
    apply(zoomRef.current);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // "+" needs Shift on most layouts, so Shift must not disqualify it —
      // browsers treat Ctrl+Shift+= as zoom-in for the same reason.
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        apply(zoomRef.current + APP_ZOOM.step);
      } else if (!e.shiftKey && (e.key === "-" || e.key === "0")) {
        e.preventDefault();
        apply(e.key === "0" ? APP_ZOOM.initial : zoomRef.current - APP_ZOOM.step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply]);

  const percent = Math.round(zoom * 100);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`App zoom ${percent} percent, open zoom controls`}
          className="hidden rounded px-1.5 py-1 text-[11px] tabular-nums text-muted-foreground hover:text-foreground md:inline"
        >
          {percent}%
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Zoom out"
            disabled={zoom <= APP_ZOOM.min}
            onClick={() => apply(zoom - APP_ZOOM.step)}
          >
            <Minus />
          </Button>
          <input
            type="range"
            min={APP_ZOOM.min * 100}
            max={APP_ZOOM.max * 100}
            step={APP_ZOOM.step * 100}
            value={percent}
            onChange={(e) => apply(Number(e.target.value) / 100)}
            className="min-w-0 flex-1 accent-primary"
            aria-label="App zoom"
          />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Zoom in"
            disabled={zoom >= APP_ZOOM.max}
            onClick={() => apply(zoom + APP_ZOOM.step)}
          >
            <Plus />
          </Button>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs tabular-nums text-muted-foreground">{percent}%</span>
          <Button size="xs" variant="ghost" onClick={() => apply(APP_ZOOM.initial)}>
            <RotateCcw />
            Reset
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Ctrl+= / Ctrl+- / Ctrl+0</p>
      </PopoverContent>
    </Popover>
  );
}

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

  // Overflow menu (T-0348): tabs scrolled out of the strip stay where they are —
  // hiding them would restart the measure/hide loop — and the `»` button lists
  // whichever are out of view so they stay one click away.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());
  const [overflowTabs, setOverflowTabs] = useState<Tab[]>([]);
  const measureOverflow = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const out: Tab[] = [];
    if (strip.scrollWidth > strip.clientWidth + 1) {
      const box = strip.getBoundingClientRect();
      for (const { key } of TABS) {
        const el = tabRefs.current.get(key);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.left < box.left - 1 || r.right > box.right + 1) out.push(key);
      }
    }
    // Same content → same state: measuring on every scroll must not re-render.
    setOverflowTabs((prev) =>
      prev.length === out.length && prev.every((t, i) => t === out[i]) ? prev : out,
    );
  }, []);
  const rafRef = useRef(0);
  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(measureOverflow);
  }, [measureOverflow]);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    measureOverflow();
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(strip);
    strip.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      strip.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measureOverflow, scheduleMeasure, tab]);

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

  // Re-read the config before opening Settings: the Voice, Ink, Clips and
  // Docs tabs save their own settings straight to disk, so the copy held here
  // can be stale — and the dialog saves its whole draft, which would silently
  // revert whatever those tabs changed (T-0277).
  const openSettings = useCallback(async () => {
    try {
      const cfg = await api.getConfig();
      setSettings(cfg.settings);
    } catch {
      // Fall back to the copy already held rather than not opening at all.
    }
    setShowSettings(true);
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
              fourteen tabs plus the status cluster need ~1570px, well past the 720px
              minimum window size. Labels collapse below `xl` (the tooltip then
              names the tab), the active tab keeps its label so the current
              position stays readable, this container scrolls as the last
              resort at the narrowest widths, and the `»` button (T-0348) lists
              whichever tabs scrolled out of sight. */}
          <div
            ref={stripRef}
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
                  ref={(el) => {
                    if (tab === key) activeTabRef.current = el;
                    if (el) tabRefs.current.set(key, el);
                    else tabRefs.current.delete(key);
                  }}
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
          {overflowTabs.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="More tabs"
                  className="shrink-0 text-muted-foreground"
                >
                  <ChevronsRight className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>More tabs</DropdownMenuLabel>
                {overflowTabs.map((key) => {
                  const entry = TABS.find((t) => t.key === key)!;
                  const Icon = entry.icon;
                  return (
                    <DropdownMenuItem key={key} onClick={() => setTab(key)}>
                      <Icon className="size-4" />
                      {entry.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
            <ZoomControl />
            <span className="hidden text-[11px] text-muted-foreground md:inline">
              v{version}
            </span>
            <NavListenerButton />
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => void openSettings()}
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>
        </nav>
        <div className="min-h-0 flex-1">
          <TabPanel id="tasks" tab={tab}>
            <TasksView
              configVersion={configVersion}
              projectsVersion={vaultProjectsVersion}
              focus={focusFor("tasks")}
              onSettingsChange={(s) => setSettings(s)}
            />
          </TabPanel>
          <TabPanel id="projects" tab={tab}>
            <ProjectsView
              configVersion={configVersion}
              active={tab === "projects"}
              onNavigate={focusOn}
              onProjectsChange={() => setVaultProjectsVersion((v) => v + 1)}
            />
          </TabPanel>
          <TabPanel id="repos" tab={tab}>
            <ReposView
              configVersion={configVersion}
              active={tab === "repos"}
              focus={focusFor("repos")}
            />
          </TabPanel>
          <TabPanel id="schedule" tab={tab}>
            <ScheduleView
              configVersion={configVersion}
              projectsVersion={vaultProjectsVersion}
              focus={focusFor("schedule")}
            />
          </TabPanel>
          <TabPanel id="mindmap" tab={tab}>
            <MindmapView
              configVersion={configVersion}
              projectsVersion={vaultProjectsVersion}
              focus={focusFor("mindmap")}
            />
          </TabPanel>
          <TabPanel id="docs" tab={tab}>
            <DocsView />
          </TabPanel>
          <TabPanel id="inbox" tab={tab}>
            <InboxView configVersion={configVersion} active={tab === "inbox"} />
          </TabPanel>
          <TabPanel id="music" tab={tab}>
            <MusicView configVersion={configVersion} />
          </TabPanel>
          <TabPanel id="timer" tab={tab}>
            <TimerView />
          </TabPanel>
          <TabPanel id="voice" tab={tab}>
            <VoiceView configVersion={configVersion} />
          </TabPanel>
          <TabPanel id="clips" tab={tab}>
            <ClipsView configVersion={configVersion} />
          </TabPanel>
          <TabPanel id="ink" tab={tab}>
            <InkView configVersion={configVersion} />
          </TabPanel>
          <TabPanel id="persona" tab={tab}>
            <PersonaView active={tab === "persona"} />
          </TabPanel>
          <TabPanel id="plugins" tab={tab}>
            <PluginsView active={tab === "plugins"} vaultPath={settings?.vault_path ?? ""} />
          </TabPanel>
          <TabPanel id="help" tab={tab}>
            <HelpView />
          </TabPanel>
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
