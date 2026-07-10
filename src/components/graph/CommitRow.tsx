import { memo } from "react";
import {
  Copy,
  GitBranch,
  GitMerge,
  History,
  Redo2,
  Tag,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { COL_W, ROW_H, type Edge, type RowLayout } from "@/lib/gitGraph";
import { timeAgo } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CommitEntry, CommitRef, GraphOp } from "@/types";

export type DialogRequest =
  | {
      kind: "confirm";
      title: string;
      description: string;
      confirmLabel: string;
      destructive?: boolean;
      onConfirm: () => void;
    }
  | {
      kind: "name";
      title: string;
      placeholder: string;
      withCheckout?: boolean;
      onSubmit: (name: string, checkout: boolean) => void;
    };

interface Props {
  entry: CommitEntry;
  layout: RowLayout;
  isHead: boolean;
  isWorktree: boolean;
  detached: boolean;
  currentBranch: string;
  opBusy: string | null;
  onOp: (label: string, op: GraphOp) => void;
  onCopy: (text: string, what: string) => void;
  onRequestDialog: (dialog: DialogRequest) => void;
  onDeleteBranch: (name: string) => void;
}

function refTone(kind: CommitRef["kind"]) {
  switch (kind) {
    case "branch":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "remote":
      return "border-sky-500/30 bg-sky-500/10 text-sky-400";
    case "tag":
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
    case "head":
      return "border-border bg-muted/60 text-muted-foreground";
  }
}

function EdgePath({ edge, half }: { edge: Edge; half: "top" | "bottom" }) {
  const x1 = edge.fromCol * COL_W + COL_W / 2;
  const x2 = edge.toCol * COL_W + COL_W / 2;
  if (edge.fromCol === edge.toCol) {
    const [y1, y2] = half === "top" ? [0, ROW_H / 2] : [ROW_H / 2, ROW_H];
    return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={edge.color} strokeWidth={2} />;
  }
  const d =
    half === "top"
      ? `M ${x1},0 C ${x1},${ROW_H / 2} ${x2},${ROW_H / 2} ${x2},${ROW_H / 2}`
      : `M ${x1},${ROW_H / 2} C ${x2},${ROW_H / 2} ${x2},${ROW_H / 2} ${x2},${ROW_H}`;
  return <path d={d} stroke={edge.color} strokeWidth={2} fill="none" />;
}

function LaneGraphic({ layout, isHead, isWorktree }: { layout: RowLayout; isHead: boolean; isWorktree: boolean }) {
  const cx = layout.column * COL_W + COL_W / 2;
  const cy = ROW_H / 2;
  return (
    <svg width={(layout.maxCol + 1) * COL_W} height={ROW_H} className="shrink-0">
      {layout.edgesTop.map((edge, i) => (
        <EdgePath key={`t${i}`} edge={edge} half="top" />
      ))}
      {layout.edgesBottom.map((edge, i) => (
        <EdgePath key={`b${i}`} edge={edge} half="bottom" />
      ))}
      {isWorktree ? (
        <circle cx={cx} cy={cy} r={3.5} fill="none" stroke={layout.color} strokeWidth={2} strokeDasharray="2 2" />
      ) : (
        <circle cx={cx} cy={cy} r={3.5} fill={layout.color} />
      )}
      {isHead && <circle cx={cx} cy={cy} r={6} fill="none" stroke={layout.color} strokeWidth={1.5} />}
    </svg>
  );
}

function RefBadge({
  commitRef,
  currentBranch,
  detached,
  opBusy,
  onOp,
  onCopy: _onCopy,
  onRequestDialog,
  onDeleteBranch,
}: {
  commitRef: CommitRef;
  currentBranch: string;
  detached: boolean;
  opBusy: string | null;
  onOp: (label: string, op: GraphOp) => void;
  onCopy: (text: string, what: string) => void;
  onRequestDialog: (dialog: DialogRequest) => void;
  onDeleteBranch: (name: string) => void;
}) {
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "h-5 gap-1 px-1.5 text-[11px] font-medium",
        refTone(commitRef.kind),
        commitRef.is_head && commitRef.kind === "branch" && "font-bold",
      )}
    >
      {commitRef.kind === "branch" && <GitBranch className="size-3" />}
      {commitRef.kind === "tag" && <Tag className="size-3" />}
      <span className="max-w-32 truncate">{commitRef.name}</span>
    </Badge>
  );

  if (commitRef.kind === "head") return badge;

  const stopRowMenu = (e: React.MouseEvent) => e.stopPropagation();

  if (commitRef.kind === "branch") {
    if (commitRef.is_head) return badge;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={stopRowMenu}>
          {badge}
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!!opBusy}
              onClick={() => onOp("Checkout", { kind: "checkout", branch: commitRef.name })}
            >
              <GitBranch /> Checkout
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!!opBusy || detached}
              onClick={() => onOp(`Merge ${commitRef.name}`, { kind: "merge", branch: commitRef.name })}
            >
              <GitMerge /> Merge into {currentBranch || "current"}…
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!!opBusy || detached}
              onClick={() => onOp(`Rebase onto ${commitRef.name}`, { kind: "rebase", branch: commitRef.name })}
            >
              <Redo2 /> Rebase {currentBranch || "current"} onto this
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!!opBusy}
              onClick={() =>
                onRequestDialog({
                  kind: "confirm",
                  title: "Delete branch",
                  description: `Delete local branch "${commitRef.name}"?`,
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: () => onDeleteBranch(commitRef.name),
                })
              }
            >
              <Trash2 /> Delete…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenu>
    );
  }

  if (commitRef.kind === "remote") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={stopRowMenu}>
          {badge}
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!!opBusy}
              onClick={() => onOp("Checkout", { kind: "checkout", branch: commitRef.name })}
            >
              <GitBranch /> Checkout
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={stopRowMenu}>
        {badge}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            disabled={!!opBusy}
            onClick={() =>
              onRequestDialog({
                kind: "confirm",
                title: "Delete tag",
                description: `Delete tag "${commitRef.name}"?`,
                confirmLabel: "Delete",
                destructive: true,
                onConfirm: () => onOp("Delete tag", { kind: "delete_tag", name: commitRef.name }),
              })
            }
          >
            <Trash2 /> Delete tag…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}

export const CommitRow = memo(function CommitRow({
  entry,
  layout,
  isHead,
  isWorktree,
  detached,
  currentBranch,
  opBusy,
  onOp,
  onCopy,
  onRequestDialog,
  onDeleteBranch,
}: Props) {
  const rowContent = (
    <div
      className="flex h-7 items-center gap-2 rounded px-1.5 hover:bg-accent/30"
      style={{ height: ROW_H }}
    >
      <LaneGraphic layout={layout} isHead={isHead} isWorktree={isWorktree} />
      {entry.refs.map((r) => (
        <RefBadge
          key={`${r.kind}:${r.name}`}
          commitRef={r}
          currentBranch={currentBranch}
          detached={detached}
          opBusy={opBusy}
          onOp={onOp}
          onCopy={onCopy}
          onRequestDialog={onRequestDialog}
          onDeleteBranch={onDeleteBranch}
        />
      ))}
      <span className="truncate text-[13px]">{entry.subject}</span>
      {!isWorktree && (
        <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
          {entry.author} · {timeAgo(entry.date)}
        </span>
      )}
    </div>
  );

  if (isWorktree) return rowContent;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onCopy(entry.hash, "hash")}>
            <Copy /> Copy hash
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCopy(entry.subject, "message")}>
            <Copy /> Copy message
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!!opBusy}
            onClick={() =>
              onRequestDialog({
                kind: "name",
                title: "Create branch",
                placeholder: "branch name",
                withCheckout: true,
                onSubmit: (name, checkout) =>
                  onOp("Create branch", { kind: "create_branch", name, hash: entry.hash, checkout }),
              })
            }
          >
            <GitBranch /> Create branch here…
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!!opBusy}
            onClick={() =>
              onRequestDialog({
                kind: "name",
                title: "Create tag",
                placeholder: "tag name",
                onSubmit: (name) => onOp("Create tag", { kind: "create_tag", name, hash: entry.hash }),
              })
            }
          >
            <Tag /> Create tag here…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!!opBusy || detached}
            onClick={() => onOp("Cherry-pick", { kind: "cherry_pick", hash: entry.hash })}
          >
            <History /> Cherry-pick onto current
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={!!opBusy || detached}>
              <Redo2 /> Reset current branch to here
            </ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent>
                {(["soft", "mixed", "hard"] as const).map((mode) => (
                  <ContextMenuItem
                    key={mode}
                    variant={mode === "hard" ? "destructive" : "default"}
                    onClick={() =>
                      onRequestDialog({
                        kind: "confirm",
                        title: `Reset (${mode})`,
                        description: `Reset the current branch to this commit using --${mode}?`,
                        confirmLabel: "Reset",
                        destructive: mode === "hard",
                        onConfirm: () => onOp(`Reset (${mode})`, { kind: "reset", hash: entry.hash, mode }),
                      })
                    }
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
});
