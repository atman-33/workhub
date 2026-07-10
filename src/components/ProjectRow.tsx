import { memo } from "react";
import {
  Code2,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  NotebookPen,
  RefreshCw,
  Sparkles,
  SquareTerminal,
  Star,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { GitInfo, Project } from "@/types";

export type RowAction =
  | { kind: "openCode" }
  | { kind: "terminal" }
  | { kind: "agent" }
  | { kind: "explorer" }
  | { kind: "fetch" }
  | { kind: "pull" }
  | { kind: "switch"; branch: string }
  | { kind: "graph" }
  | { kind: "notes" }
  | { kind: "favorite" }
  | { kind: "copyPath" }
  | { kind: "openRepo" }
  | { kind: "remove" };

interface Props {
  project: Project;
  info?: GitInfo;
  busy?: string;
  selected: boolean;
  onToggle: () => void;
  onAction: (action: RowAction) => void;
}

function chipTone(tone: "green" | "orange" | "amber" | "blue" | "purple" | "red" | "gray") {
  switch (tone) {
    case "green":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    case "orange":
      return "border-orange-500/30 bg-orange-500/10 text-orange-400";
    case "amber":
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
    case "blue":
      return "border-sky-500/30 bg-sky-500/10 text-sky-400";
    case "purple":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "red":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    case "gray":
      return "border-border bg-muted/60 text-muted-foreground";
  }
}

function Chip({
  tone,
  title,
  children,
}: {
  tone: Parameters<typeof chipTone>[0];
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("h-5 gap-1 px-1.5 text-[11px] font-medium", chipTone(tone))}>
          {children}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export const ProjectRow = memo(function ProjectRow({
  project,
  info,
  busy,
  selected,
  onToggle,
  onAction,
}: Props) {
  const tags = project.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const safe = info?.is_repo && !info.error && info.changes === 0 && info.behind === 0;

  return (
    <div
      className={cn(
        "group flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-2.5 transition-colors",
        selected
          ? "border-primary/60 bg-primary/10"
          : "border-transparent hover:border-border hover:bg-accent/40",
      )}
      onClick={onToggle}
    >
      <Checkbox
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={onToggle}
        aria-label={`select ${project.name}`}
      />
      <button
        className="text-muted-foreground transition-colors hover:text-amber-400"
        onClick={(e) => {
          e.stopPropagation();
          onAction({ kind: "favorite" });
        }}
        title="favorite (pinned to top)"
      >
        <Star className={cn("size-4", project.favorite && "fill-amber-400 text-amber-400")} />
      </button>

      <span className="max-w-48 truncate text-[13px] font-semibold">{project.name}</span>
      {tags.map((t) => (
        <Badge
          key={t}
          variant="secondary"
          className="hidden h-5 px-1.5 text-[10px] text-primary/90 lg:inline-flex"
        >
          #{t}
        </Badge>
      ))}
      {project.notes.trim() && (
        <NotebookPen className="size-3.5 shrink-0 text-amber-400/80" aria-label="has notes" />
      )}

      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
          {project.path}
        </span>
        <button
          className="shrink-0 text-muted-foreground opacity-70 transition-colors hover:text-foreground group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onAction({ kind: "copyPath" });
          }}
          title="copy path"
        >
          <Copy className="size-3.5" />
        </button>
      </span>

      {busy && <Loader2 className="size-3.5 animate-spin text-primary" />}

      {!info ? (
        <Chip tone="gray" title="reading git status…">
          …
        </Chip>
      ) : !info.is_repo ? (
        <Chip tone="gray" title="this folder is not a git repository">
          no git
        </Chip>
      ) : (
        <>
          {info.error && (
            <Chip tone="red" title={info.error}>
              error
            </Chip>
          )}
          {safe && (
            <Chip tone="green" title="clean and up to date — safe to start working">
              ✓ ready
            </Chip>
          )}
          {info.behind > 0 && (
            <Chip tone="orange" title="remote has commits you don't — pull before starting work">
              ↓{info.behind} pull
            </Chip>
          )}
          {info.changes > 0 && (
            <Chip tone="amber" title="uncommitted changes — this repo is mid-work">
              ●{info.changes}
            </Chip>
          )}
          {info.ahead > 0 && (
            <Chip tone="blue" title="local commits not pushed yet">
              ↑{info.ahead}
            </Chip>
          )}
          {!info.has_upstream && !info.detached && (
            <Chip tone="gray" title="branch has no remote tracking branch">
              no upstream
            </Chip>
          )}
          <Chip tone="purple" title="current branch">
            <GitBranch className="size-3" />
            <span className="max-w-28 truncate">{info.branch || "?"}</span>
          </Chip>
        </>
      )}

      <span className="hidden w-14 shrink-0 text-right text-[10px] text-muted-foreground/60 xl:block">
        {project.last_opened ? timeAgo(project.last_opened) : ""}
      </span>

      <Button
        size="sm"
        variant="secondary"
        className="h-7 gap-1.5 px-2.5 text-xs opacity-70 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onAction({ kind: "openCode" });
        }}
      >
        <Code2 className="size-3.5" />
        Code
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 opacity-60 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
            {project.name}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onAction({ kind: "terminal" })}>
            <SquareTerminal className="size-4" /> Open terminal
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction({ kind: "agent" })}>
            <Sparkles className="size-4" /> Launch AI agent
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction({ kind: "explorer" })}>
            <FolderOpen className="size-4" /> Open in Explorer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction({ kind: "copyPath" })}>
            <Copy className="size-4" /> Copy path
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction({ kind: "openRepo" })}>
            <ExternalLink className="size-4" /> Open on GitHub
          </DropdownMenuItem>
          {info?.is_repo && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onAction({ kind: "graph" })}>
                <GitCommitHorizontal className="size-4" /> Commit graph
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!!busy} onClick={() => onAction({ kind: "fetch" })}>
                <RefreshCw className="size-4" /> Fetch
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!!busy} onClick={() => onAction({ kind: "pull" })}>
                <Download className="size-4" /> Pull (ff-only)
              </DropdownMenuItem>
              {info.branches.length > 0 && !info.detached && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={!!busy}>
                    <GitBranch className="mr-2 size-4" /> Switch branch
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                      <DropdownMenuRadioGroup
                        value={info.branch}
                        onValueChange={(b) => {
                          if (b !== info.branch) onAction({ kind: "switch", branch: b });
                        }}
                      >
                        {info.branches.map((b) => (
                          <DropdownMenuRadioItem key={b} value={b}>
                            {b}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAction({ kind: "notes" })}>
            <NotebookPen className="size-4" /> Notes & tags…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => onAction({ kind: "remove" })}>
            <Trash2 className="size-4" /> Remove from Workhub
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
