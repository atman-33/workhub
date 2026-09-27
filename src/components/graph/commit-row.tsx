import { memo } from "react";
import {
  Copy,
  Eraser,
  GitBranch,
  GitCommitHorizontal,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COL_W, ROW_H, type Edge, type RowLayout } from "@/lib/git-graph";
import { formatCommitDate, formatCommitDateFull } from "@/lib/commit-format";
import { timeAgo } from "@/lib/api";
import { useT } from "@/lib/i18n";
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
  selected: boolean;
  opBusy: string | null;
  onOp: (label: string, op: GraphOp) => void;
  onCopy: (text: string, what: string) => void;
  onRequestDialog: (dialog: DialogRequest) => void;
  onDeleteBranch: (name: string) => void;
  onSelect: () => void;
}

/**
 * Tone for a ref badge. The checked-out ref (`isCurrent`) gets a solid fill so
 * it stands out among the outlined refs sharing the same hue — a bold 11px
 * label alone is not enough to spot at a glance.
 */
export function refTone(kind: CommitRef["kind"], isCurrent = false) {
  switch (kind) {
    case "branch":
      return isCurrent
        ? "border-violet-400 bg-violet-500 text-white ring-1 ring-violet-300/40"
        : "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "remote":
      return "border-sky-500/30 bg-sky-500/10 text-sky-400";
    case "tag":
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
    case "head":
      // Only ever rendered for a detached HEAD.
      return isCurrent
        ? "border-amber-400 bg-amber-500 text-zinc-950 ring-1 ring-amber-300/40"
        : "border-border bg-muted/60 text-muted-foreground";
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
      {/* The HEAD ring is drawn in the foreground color, not the lane color, so
          it reads equally strongly on top of any of the 10 lane hues. */}
      {isHead && (
        <circle
          cx={cx}
          cy={cy}
          r={6}
          fill="none"
          className="stroke-foreground"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}

function RefBadge({
  commitRef,
  currentBranch,
  detached,
  opBusy,
  onOp,
  onCopy,
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
  const t = useT();
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "h-5 gap-1 px-1.5 text-[11px] font-medium",
        refTone(commitRef.kind, commitRef.is_head),
        commitRef.is_head && "font-bold",
      )}
    >
      {commitRef.kind === "branch" && <GitBranch className="size-3" />}
      {commitRef.kind === "tag" && <Tag className="size-3" />}
      <span className="max-w-32 truncate">{commitRef.name}</span>
    </Badge>
  );

  // Reveal the full ref name on hover, since the badge truncates long names.
  const withTooltip = (trigger: React.ReactElement) => (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{commitRef.name}</TooltipContent>
    </Tooltip>
  );

  if (commitRef.kind === "head") return withTooltip(badge);

  const stopRowMenu = (e: React.MouseEvent) => e.stopPropagation();

  if (commitRef.kind === "branch") {
    if (commitRef.is_head) return withTooltip(badge);
    return (
      <ContextMenu>
        {withTooltip(
          <ContextMenuTrigger asChild onContextMenu={stopRowMenu}>
            {badge}
          </ContextMenuTrigger>,
        )}
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!!opBusy}
              onClick={() => onOp(t("graph.op.checkout"), { kind: "checkout", branch: commitRef.name })}
            >
              <GitBranch /> {t("graph.op.checkout")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!!opBusy || detached}
              onClick={() =>
                onOp(t("graph.op.merge", { branch: commitRef.name }), {
                  kind: "merge",
                  branch: commitRef.name,
                })
              }
            >
              <GitMerge />{" "}
              {t("graph.op.mergeInto", {
                branch: currentBranch || t("graph.op.currentBranchFallback"),
              })}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!!opBusy || detached}
              onClick={() =>
                onOp(t("graph.op.rebase", { branch: commitRef.name }), {
                  kind: "rebase",
                  branch: commitRef.name,
                })
              }
            >
              <Redo2 />{" "}
              {t("graph.op.rebaseOnto", {
                branch: currentBranch || t("graph.op.currentBranchFallback"),
              })}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onCopy(commitRef.name, t("graph.copyKind.branchName"))}>
              <Copy /> {t("graph.op.copyBranchName")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!!opBusy}
              onClick={() =>
                onRequestDialog({
                  kind: "confirm",
                  title: t("graph.op.deleteBranchTitle"),
                  description: t("graph.op.deleteBranchDescription", { branch: commitRef.name }),
                  confirmLabel: t("common.delete"),
                  destructive: true,
                  onConfirm: () => onDeleteBranch(commitRef.name),
                })
              }
            >
              <Trash2 /> {t("graph.op.deleteEllipsis")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenu>
    );
  }

  if (commitRef.kind === "remote") {
    // `origin/HEAD` is a symref alias, not a checkoutable branch.
    if (commitRef.name.endsWith("/HEAD")) return withTooltip(badge);
    return (
      <ContextMenu>
        {withTooltip(
          <ContextMenuTrigger asChild onContextMenu={stopRowMenu}>
            {badge}
          </ContextMenuTrigger>,
        )}
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={!!opBusy}
              onClick={() => onOp(t("graph.op.checkout"), { kind: "checkout", branch: commitRef.name })}
            >
              <GitBranch /> {t("graph.op.checkout")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onCopy(commitRef.name, t("graph.copyKind.branchName"))}>
              <Copy /> {t("graph.op.copyBranchName")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      {withTooltip(
        <ContextMenuTrigger asChild onContextMenu={stopRowMenu}>
          {badge}
        </ContextMenuTrigger>,
      )}
      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem
            variant="destructive"
            disabled={!!opBusy}
            onClick={() =>
              onRequestDialog({
                kind: "confirm",
                title: t("graph.op.deleteTagTitle"),
                description: t("graph.op.deleteTagDescription", { tag: commitRef.name }),
                confirmLabel: t("common.delete"),
                destructive: true,
                onConfirm: () =>
                  onOp(t("graph.op.deleteTag"), { kind: "delete_tag", name: commitRef.name }),
              })
            }
          >
            <Trash2 /> {t("graph.op.deleteTagEllipsis")}
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
  selected,
  opBusy,
  onOp,
  onCopy,
  onRequestDialog,
  onDeleteBranch,
  onSelect,
}: Props) {
  const t = useT();
  const rowContent = (
    <div
      className={cn(
        "flex h-7 cursor-pointer items-center gap-2 rounded px-1.5 hover:bg-accent/30",
        // Tint + left accent on the checked-out commit. Uses an inset shadow
        // rather than a border/padding so the row keeps its exact ROW_H height,
        // which the virtualized scroll offsets depend on.
        isHead &&
          "bg-violet-500/[0.07] shadow-[inset_2px_0_0_0_var(--color-violet-400)]",
        selected && "bg-accent/60 hover:bg-accent/60",
      )}
      style={{ height: ROW_H }}
      onClick={onSelect}
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
        // The row shows an absolute date — "12h ago" alone never answers *when*.
        // The relative form still reads faster when skimming, so it moves into
        // the tooltip alongside the unabbreviated timestamp.
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
              <code className="font-mono">{entry.hash.slice(0, 7)}</code>
              <span className="max-w-24 truncate">{entry.author}</span>
              <span className="tabular-nums">· {formatCommitDate(entry.date)}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {formatCommitDateFull(entry.date)} ({timeAgo(entry.date)})
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  if (isWorktree) {
    // The synthetic uncommitted-changes row: its only action is discarding
    // the work-tree changes it represents.
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuSub>
              <ContextMenuSubTrigger disabled={!!opBusy}>
                <Eraser /> {t("graph.op.discardChanges")}
              </ContextMenuSubTrigger>
              <ContextMenuPortal>
                <ContextMenuSubContent>
                  <ContextMenuItem
                    onClick={() =>
                      onRequestDialog({
                        kind: "confirm",
                        title: t("graph.op.discardChanges"),
                        description: t("graph.op.discardChangesDescription"),
                        confirmLabel: t("graph.op.discard"),
                        destructive: true,
                        onConfirm: () =>
                          onOp(t("graph.op.discardChanges"), {
                            kind: "discard_changes",
                            include_untracked: false,
                          }),
                      })
                    }
                  >
                    {t("graph.op.trackedOnly")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() =>
                      onRequestDialog({
                        kind: "confirm",
                        title: t("graph.op.discardAllTitle"),
                        description: t("graph.op.discardAllDescription"),
                        confirmLabel: t("graph.op.discardAll"),
                        destructive: true,
                        onConfirm: () =>
                          onOp(t("graph.op.discardAllTitle"), {
                            kind: "discard_changes",
                            include_untracked: true,
                          }),
                      })
                    }
                  >
                    {t("graph.op.includeUntracked")}
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuPortal>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={!!opBusy || isHead}
            onClick={() =>
              onRequestDialog({
                kind: "confirm",
                title: t("graph.op.checkoutCommitTitle"),
                description: t("graph.op.checkoutCommitDescription", {
                  hash: entry.hash.slice(0, 7),
                }),
                confirmLabel: t("graph.op.checkout"),
                onConfirm: () =>
                  onOp(t("graph.op.checkoutCommitTitle"), { kind: "checkout_commit", hash: entry.hash }),
              })
            }
          >
            <GitCommitHorizontal /> {t("graph.op.checkoutCommitEllipsis")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!!opBusy}
            onClick={() =>
              onRequestDialog({
                kind: "name",
                title: t("graph.op.createBranchTitle"),
                placeholder: t("graph.op.branchNamePlaceholder"),
                withCheckout: true,
                onSubmit: (name, checkout) =>
                  onOp(t("graph.op.createBranch"), {
                    kind: "create_branch",
                    name,
                    hash: entry.hash,
                    checkout,
                  }),
              })
            }
          >
            <GitBranch /> {t("graph.op.createBranchEllipsis")}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!!opBusy}
            onClick={() =>
              onRequestDialog({
                kind: "name",
                title: t("graph.op.createTagTitle"),
                placeholder: t("graph.op.tagNamePlaceholder"),
                onSubmit: (name) =>
                  onOp(t("graph.op.createTag"), { kind: "create_tag", name, hash: entry.hash }),
              })
            }
          >
            <Tag /> {t("graph.op.createTagEllipsis")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!!opBusy || detached}
            onClick={() => onOp(t("graph.op.cherryPickLabel"), { kind: "cherry_pick", hash: entry.hash })}
          >
            <History /> {t("graph.op.cherryPick")}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={!!opBusy || detached}>
              <Redo2 /> {t("graph.op.resetToHere")}
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
                        title: t("graph.op.resetTitle", { mode }),
                        description: t("graph.op.resetDescription", { mode }),
                        confirmLabel: t("graph.op.reset"),
                        destructive: mode === "hard",
                        onConfirm: () =>
                          onOp(t("graph.op.resetTitle", { mode }), {
                            kind: "reset",
                            hash: entry.hash,
                            mode,
                          }),
                      })
                    }
                  >
                    {t(`graph.mode.${mode}`)}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onCopy(entry.hash, t("graph.copyKind.hash"))}>
            <Copy /> {t("graph.op.copyHash")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onCopy(entry.subject, t("graph.copyKind.message"))}>
            <Copy /> {t("graph.op.copyMessage")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
});
