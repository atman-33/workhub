import { useState } from "react";
import { CircleAlert, CircleCheck, GripVertical, Star } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { timeAgo } from "@/lib/api";
import { health, planProjectMove, type ProjectOrderWrite, type TaskCounts } from "@/lib/vault-project";
import { cn } from "@/lib/utils";
import type { VaultProject } from "@/types";

/**
 * The Projects tab's list pane (T-0231).
 *
 * Split out of `projects-view.tsx` when the rows grew a pin and a drag: the
 * view's job is loading and reconciliation, and the ordering interaction is
 * self-contained enough to own its own drag state.
 *
 * The list is three sections — pinned, the rest, then archived — and a project
 * moves between the first two by being dropped there as much as by its star,
 * because "drag it to the top to say I am working on this" is the gesture the
 * pin exists to serve.
 *
 * Reordering is disabled while a search is running. A filtered list hides rows
 * between the ones on screen, so a position computed from what is visible
 * would record an order the user never asked for. Archived projects are never
 * a drag target either: they sort last unconditionally.
 */

interface Props {
  /** Active (non-archived) projects, in display order. */
  active: VaultProject[];
  /** Archived projects, shown in their own section below. Empty when the
   *  Archived toggle is off. */
  archived: VaultProject[];
  selected: string;
  counts: Map<string, TaskCounts>;
  /** False while a search filters the list — see the note above. */
  reorderable: boolean;
  onSelect: (slug: string) => void;
  onTogglePin: (project: VaultProject) => void;
  /** The writes one drop implies; usually a single project. */
  onMove: (writes: ProjectOrderWrite[]) => void;
}

/** Which group a row belongs to, and therefore which list a drop reorders. */
type Group = "pinned" | "plain";

/** Where a drop would insert: the group, plus the index within it. */
type DropPos = { group: Group; index: number } | null;

export function ProjectList({
  active,
  archived,
  selected,
  counts,
  reorderable,
  onSelect,
  onTogglePin,
  onMove,
}: Props) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<DropPos>(null);

  const pinned = active.filter((p) => p.pinned);
  const plain = active.filter((p) => !p.pinned);

  const handleDrop = (group: Group, index: number) => {
    setDropPos(null);
    const slug = dragged;
    setDragged(null);
    if (!slug) return;
    const rows = group === "pinned" ? pinned : plain;
    const writes = planProjectMove(rows, slug, index, group === "pinned");
    if (writes.length > 0) onMove(writes);
  };

  /** Insert before or after a row, depending on which half the pointer is in. */
  const rowInsertIndex = (e: React.DragEvent, index: number) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY - box.top > box.height / 2 ? index + 1 : index;
  };

  const renderRow = (p: VaultProject, group: Group | null, index: number) => {
    const h = health(p);
    const c = counts.get(p.slug);
    const draggable = reorderable && group !== null;
    const showLine =
      group !== null && dropPos?.group === group && dropPos.index === index;
    return (
      <div key={p.slug}>
        {showLine && <div className="h-0.5 bg-primary" />}
        <div
          role="button"
          tabIndex={0}
          draggable={draggable}
          onDragStart={() => setDragged(p.slug)}
          onDragEnd={() => {
            setDragged(null);
            setDropPos(null);
          }}
          onDragOver={
            draggable
              ? (e) => {
                  if (!dragged) return;
                  e.preventDefault();
                  setDropPos({ group, index: rowInsertIndex(e, index) });
                }
              : undefined
          }
          onDrop={
            draggable
              ? (e) => {
                  e.preventDefault();
                  handleDrop(group, rowInsertIndex(e, index));
                }
              : undefined
          }
          onClick={() => onSelect(p.slug)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(p.slug);
            }
          }}
          className={cn(
            "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left transition-colors",
            draggable && "cursor-grab active:cursor-grabbing",
            p.slug === selected ? "bg-muted" : "hover:bg-muted/50",
            dragged === p.slug && "opacity-40",
          )}
        >
          <div className="flex items-center gap-2">
            {draggable && (
              <GripVertical className="size-3 shrink-0 text-muted-foreground/50" />
            )}
            {!p.archived && (
              <Hint label={p.pinned ? "unpin" : "pin to the top"}>
                <button
                  className="shrink-0 text-muted-foreground transition-colors hover:text-amber-400"
                  aria-label={p.pinned ? `unpin ${p.name}` : `pin ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(p);
                  }}
                >
                  <Star
                    className={cn(
                      "size-3.5",
                      p.pinned && "fill-amber-400 text-amber-400",
                    )}
                  />
                </button>
              </Hint>
            )}
            <span className="truncate text-sm font-medium">{p.name}</span>
            {p.archived && (
              <span className="rounded bg-muted-foreground/15 px-1 text-[10px] uppercase text-muted-foreground">
                archived
              </span>
            )}
            {h.warn > 0 ? (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-destructive">
                <CircleAlert className="size-3" />
                {h.warn}
              </span>
            ) : (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <CircleCheck className="size-3" />
                ok
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{p.slug}</span>
            <span>·</span>
            <span>{c ? `${c.total} tasks` : "no tasks"}</span>
            <span>·</span>
            <span>{p.updated ? timeAgo(p.updated) : "—"}</span>
          </div>
        </div>
      </div>
    );
  };

  /** The strip below a group's last row, so a project can be dropped at the
   *  end — and, for an empty pinned group, so there is somewhere to drop at
   *  all. Without it the top section could never receive its first project. */
  const tail = (group: Group, count: number, label?: string) => {
    if (!reorderable) return null;
    const showLine = dropPos?.group === group && dropPos.index === count;
    return (
      <div
        onDragOver={(e) => {
          if (!dragged) return;
          e.preventDefault();
          setDropPos({ group, index: count });
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop(group, count);
        }}
        className={cn(count === 0 ? "px-3 py-2" : "h-3")}
      >
        {showLine && <div className="h-0.5 bg-primary" />}
        {count === 0 && label && (
          <p className="text-[11px] text-muted-foreground">{label}</p>
        )}
      </div>
    );
  };

  return (
    <>
      {(pinned.length > 0 || (reorderable && dragged !== null)) && (
        <>
          <p className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            Pinned
          </p>
          {pinned.map((p, i) => renderRow(p, "pinned", i))}
          {tail("pinned", pinned.length, "Drop a project here to pin it.")}
        </>
      )}
      {plain.map((p, i) => renderRow(p, "plain", i))}
      {tail("plain", plain.length)}
      {archived.length > 0 && (
        <>
          <p className="border-b bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground">
            Archived
          </p>
          {archived.map((p) => renderRow(p, null, 0))}
        </>
      )}
    </>
  );
}
