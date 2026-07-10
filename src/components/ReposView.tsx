import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as pickFolders } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownToLine,
  FolderPlus,
  Layers,
  Package,
  Play,
  RefreshCw,
  Search,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { GitGraphView } from "@/components/graph/GitGraphView";
import { NotesDialog } from "@/components/NotesDialog";
import { ProjectRow, type RowAction } from "@/components/ProjectRow";
import { UpdateBanner } from "@/components/UpdateBanner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, nowUnix } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Config, GitInfo, UpdateInfo } from "@/types";

type View = { kind: "list" } | { kind: "graph"; path: string };

interface Props {
  /** Bumped by the app shell after settings are saved; triggers a config reload. */
  configVersion: number;
}

export function ReposView({ configVersion }: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [view, setView] = useState<View>({ kind: "list" });
  const [gitMap, setGitMap] = useState<Record<string, GitInfo>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [status, setStatus] = useState("");
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [notesPath, setNotesPath] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [showSavePreset, setShowSavePreset] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // ---- persistence: keep rust-side config.json in sync ----
  const persist = useCallback((cfg: Config, sel: Set<string>) => {
    const ordered = cfg.projects.map((p) => p.path).filter((p) => sel.has(p));
    void api.saveConfig({ ...cfg, selected: ordered });
  }, []);

  const mutateConfig = useCallback(
    (fn: (cfg: Config) => Config) => {
      setConfig((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        persist(next, selectedRef.current);
        return next;
      });
    },
    [persist],
  );

  const updateSelection = useCallback(
    (fn: (sel: Set<string>) => Set<string>) => {
      setSelected((prev) => {
        const next = fn(prev);
        if (configRef.current) persist(configRef.current, next);
        return next;
      });
    },
    [persist],
  );

  // ---- git status ----
  const refreshStatus = useCallback((path: string) => {
    setBusy((b) => ({ ...b, [path]: "status" }));
    void api.gitStatus(path).then((info) => {
      setGitMap((m) => ({ ...m, [path]: info }));
      setBusy((b) => {
        const { [path]: _, ...rest } = b;
        return rest;
      });
    });
  }, []);

  const refreshAll = useCallback(
    (paths: string[]) => paths.forEach((p) => refreshStatus(p)),
    [refreshStatus],
  );

  // ---- startup ----
  useEffect(() => {
    void (async () => {
      const cfg = await api.getConfig();
      setConfig(cfg);
      setSelected(new Set(cfg.selected));
      refreshAll(cfg.projects.map((p) => p.path));
      setVersion(await api.appVersion());
      if (cfg.settings.check_updates) {
        setUpdate(await api.checkUpdate());
      }
    })();
  }, [refreshAll]);

  // ---- reload config after app-level settings saves ----
  useEffect(() => {
    if (configVersion === 0) return;
    void api.getConfig().then((cfg) => {
      setConfig(cfg);
      setSelected(new Set(cfg.selected));
    });
  }, [configVersion]);

  // ---- actions ----
  const markOpened = useCallback(
    (paths: string[]) => {
      const now = nowUnix();
      mutateConfig((cfg) => ({
        ...cfg,
        projects: cfg.projects.map((p) =>
          paths.includes(p.path) ? { ...p, last_opened: now } : p,
        ),
      }));
    },
    [mutateConfig],
  );

  const runGitOp = useCallback(
    (path: string, op: "fetch" | "pull" | "switch", branch?: string) => {
      setBusy((b) => ({ ...b, [path]: op }));
      void api
        .gitOp(path, op, branch)
        .then((msg) => setStatus(`${path.split("/").pop()}: ${op} ok — ${msg}`))
        .catch((e) => setStatus(`${path.split("/").pop()}: ${op} failed — ${e}`))
        .finally(() => {
          setBusy((b) => {
            const { [path]: _, ...rest } = b;
            return rest;
          });
          refreshStatus(path);
        });
    },
    [refreshStatus],
  );

  const openSelected = useCallback(() => {
    const cfg = configRef.current;
    if (!cfg) return;
    const paths = cfg.projects.map((p) => p.path).filter((p) => selectedRef.current.has(p));
    if (paths.length === 0) return;
    void api
      .openInVscode(cfg.settings.vscode_cmd, paths)
      .then(() => {
        setStatus(`opened ${paths.length} project(s) in VS Code`);
        markOpened(paths);
      })
      .catch((e) => setStatus(`VS Code launch failed — ${e}`));
  }, [markOpened]);

  const addProjects = useCallback(async () => {
    const picked = await pickFolders({ directory: true, multiple: true, title: "Add project folders" });
    if (!picked) return;
    const folders = (Array.isArray(picked) ? picked : [picked]).map((f) => f.replaceAll("\\", "/"));
    mutateConfig((cfg) => {
      const known = new Set(cfg.projects.map((p) => p.path));
      const added = folders
        .filter((f) => !known.has(f))
        .map((f) => ({
          path: f,
          name: f.split("/").filter(Boolean).pop() ?? f,
          tags: "",
          favorite: false,
          notes: "",
          last_opened: null,
        }));
      added.forEach((p) => refreshStatus(p.path));
      return { ...cfg, projects: [...cfg.projects, ...added] };
    });
  }, [mutateConfig, refreshStatus]);

  const handleRowAction = useCallback(
    (path: string, action: RowAction) => {
      const cfg = configRef.current;
      if (!cfg) return;
      const s = cfg.settings;
      switch (action.kind) {
        case "openCode":
          void api
            .openInVscode(s.vscode_cmd, [path])
            .then(() => markOpened([path]))
            .catch((e) => setStatus(`VS Code launch failed — ${e}`));
          break;
        case "terminal":
          void api.openTerminal(s.terminal_cmd, path).then(() => markOpened([path]));
          break;
        case "agent":
          void api.launchAgent(s.agent_cmd, path).then(() => markOpened([path]));
          break;
        case "explorer":
          void api.openExplorer(path);
          break;
        case "fetch":
        case "pull":
          runGitOp(path, action.kind);
          break;
        case "switch":
          runGitOp(path, "switch", action.branch);
          break;
        case "graph":
          setView({ kind: "graph", path });
          break;
        case "notes":
          setNotesPath(path);
          break;
        case "copyPath":
          void writeText(path.replace(/\//g, "\\")).then(() => setStatus("Copied path"));
          break;
        case "openRepo":
          void api
            .gitRemoteUrl(path)
            .then((url) => openUrl(url))
            .catch((e) => setStatus(`Open on GitHub failed — ${e}`));
          break;
        case "favorite":
          mutateConfig((c) => ({
            ...c,
            projects: c.projects.map((p) =>
              p.path === path ? { ...p, favorite: !p.favorite } : p,
            ),
          }));
          break;
        case "remove":
          mutateConfig((c) => ({ ...c, projects: c.projects.filter((p) => p.path !== path) }));
          updateSelection((sel) => {
            const next = new Set(sel);
            next.delete(path);
            return next;
          });
          break;
      }
    },
    [markOpened, mutateConfig, runGitOp, updateSelection],
  );

  // ---- derived ----
  const visible = useMemo(() => {
    if (!config) return [];
    const q = search.toLowerCase();
    const tq = tagFilter.trim().toLowerCase();
    return config.projects
      .filter((p) => {
        if (favOnly && !p.favorite) return false;
        if (q && !p.name.toLowerCase().includes(q) && !p.path.toLowerCase().includes(q))
          return false;
        if (tq && !p.tags.toLowerCase().split(",").some((t) => t.trim().includes(tq)))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        if (config.sort === "Recent") return (b.last_opened ?? 0) - (a.last_opened ?? 0);
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
  }, [config, search, tagFilter, favOnly]);

  const notesProject = config?.projects.find((p) => p.path === notesPath) ?? null;

  if (!config) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        {update && (
          <UpdateBanner update={update} currentVersion={version} onDismiss={() => setUpdate(null)} />
        )}

        {view.kind === "graph" ? (
          <GitGraphView
            path={view.path}
            name={config.projects.find((p) => p.path === view.path)?.name ?? view.path}
            onClose={() => setView({ kind: "list" })}
            onRepoChanged={refreshStatus}
          />
        ) : (
          <>
          {/* header */}
          <header className="flex items-center gap-3 border-b px-4 py-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15">
              <Layers className="size-4 text-primary" />
            </div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-[15px] font-bold tracking-tight">Workhub</h1>
              <span className="text-[11px] text-muted-foreground">v{version}</span>
            </div>
  
            <div className="ml-auto flex items-center gap-2">
              {selected.size > 0 && (
                <>
                  <span className="text-xs font-medium text-primary">{selected.size} selected</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    onClick={() => updateSelection(() => new Set())}
                  >
                    <X className="size-3.5" /> Clear
                  </Button>
                </>
              )}
              <Button size="sm" className="h-8 gap-1.5" disabled={selected.size === 0} onClick={openSelected}>
                <Play className="size-3.5" />
                Open{selected.size > 1 ? ` ${selected.size}` : ""} in VS Code
              </Button>
            </div>
          </header>
  
          {/* toolbar */}
          <div className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={addProjects}>
              <FolderPlus className="size-3.5" /> Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => refreshAll(config.projects.map((p) => p.path))}
            >
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => config.projects.forEach((p) => runGitOp(p.path, "fetch"))}
            >
              <ArrowDownToLine className="size-3.5" /> Fetch all
            </Button>
  
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                  <Package className="size-3.5" /> Presets
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {config.presets.length === 0 && (
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    No presets yet — select projects and save one.
                  </DropdownMenuLabel>
                )}
                {config.presets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.name}
                    onClick={() => {
                      updateSelection(() => new Set(preset.paths));
                      setStatus(`preset '${preset.name}' loaded`);
                    }}
                  >
                    <span className="flex-1 truncate">{preset.name}</span>
                    <span className="text-xs text-muted-foreground">{preset.paths.length}</span>
                    <button
                      className="ml-1 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        mutateConfig((c) => ({
                          ...c,
                          presets: c.presets.filter((x) => x.name !== preset.name),
                        }));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={selected.size === 0} onClick={() => setShowSavePreset(true)}>
                  Save current selection…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
  
            <Separator orientation="vertical" className="h-5" />
  
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="h-8 w-44 pl-8 text-xs"
              />
            </div>
            <div className="relative">
              <Tag className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder="tag"
                className="h-8 w-24 pl-8 text-xs"
              />
            </div>
            <Button
              size="sm"
              variant={favOnly ? "secondary" : "ghost"}
              className="h-8 gap-1.5 text-xs"
              onClick={() => setFavOnly(!favOnly)}
            >
              <Star className={cn("size-3.5", favOnly && "fill-amber-400 text-amber-400")} />
              Favorites
            </Button>
  
            <div className="ml-auto flex shrink-0 items-center overflow-hidden rounded-md border">
              {(["Name", "Recent"] as const).map((mode) => (
                <button
                  key={mode}
                  className={cn(
                    "px-2.5 py-1 text-xs transition-colors",
                    config.sort === mode
                      ? "bg-secondary font-medium"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                  onClick={() => mutateConfig((c) => ({ ...c, sort: mode }))}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
  
          {/* project list */}
          <main className="flex-1 overflow-y-auto px-3 py-2">
            {config.projects.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Layers className="size-10 text-muted-foreground/40" />
                <div>
                  <p className="font-semibold">No projects yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Register local repositories to see their git status at a glance.
                  </p>
                </div>
                <Button size="sm" className="gap-1.5" onClick={addProjects}>
                  <FolderPlus className="size-3.5" /> Add projects
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <p className="mt-16 text-center text-sm text-muted-foreground">
                No projects match the current filter.
              </p>
            ) : (
              <div className="space-y-0.5">
                {visible.map((p) => (
                  <ProjectRow
                    key={p.path}
                    project={p}
                    info={gitMap[p.path]}
                    busy={busy[p.path]}
                    selected={selected.has(p.path)}
                    onToggle={() =>
                      updateSelection((sel) => {
                        const next = new Set(sel);
                        if (next.has(p.path)) next.delete(p.path);
                        else next.add(p.path);
                        return next;
                      })
                    }
                    onAction={(a) => handleRowAction(p.path, a)}
                  />
                ))}
              </div>
            )}
          </main>
  
          {/* status bar */}
          <footer className="flex items-center border-t px-4 py-1.5 text-[11px] text-muted-foreground">
            <span className="truncate">{status}</span>
            <span className="ml-auto shrink-0">
              {config.projects.length} projects · {selected.size} selected
            </span>
          </footer>
          </>
        )}

        {/* dialogs */}
        <NotesDialog
          project={notesProject}
          onClose={() => setNotesPath(null)}
          onSave={(path, notes, tags) =>
            mutateConfig((c) => ({
              ...c,
              projects: c.projects.map((p) => (p.path === path ? { ...p, notes, tags } : p)),
            }))
          }
        />
        <Dialog open={showSavePreset} onOpenChange={setShowSavePreset}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Save preset</DialogTitle>
            </DialogHeader>
            <Input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="preset name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && presetName.trim()) {
                  savePreset();
                }
              }}
            />
            <DialogFooter>
              <Button disabled={!presetName.trim()} onClick={savePreset}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );

  function savePreset() {
    const name = presetName.trim();
    const paths = config!.projects.map((p) => p.path).filter((p) => selected.has(p));
    mutateConfig((c) => ({
      ...c,
      presets: [...c.presets.filter((x) => x.name !== name), { name, paths }],
    }));
    setPresetName("");
    setShowSavePreset(false);
    setStatus(`preset '${name}' saved`);
  }
}
