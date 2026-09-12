import { useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode,
  FileText,
  Folder,
  GripVertical,
  Star,
  StarOff,
  X,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Hint } from "@/components/ui/hint";
import { baseName } from "@/lib/docs/tree-nav";
import { cn } from "@/lib/utils";
import type { DocsShortcut } from "@/types";

/**
 * The two lists above the folder tree in the Docs sidebar (T-0276):
 * **Shortcuts**, which the user curates, and **Recent files**, which the tab
 * records.
 *
 * They are the answer to the tab's real cost — a shared Drive folder is deep,
 * and getting back to the three documents that matter meant re-opening four
 * levels every time. Notebook Navigator solves it the same way.
 *
 * The split between them is deliberate and shows in where they are stored:
 * shortcuts are a decision, so they live in the vault settings and travel with
 * the roots they point into; recent files are history, so they stay in this
 * machine's `localStorage` (see `@/lib/docs/recent`).
 */

/** Whether a section is folded away. Per machine, like the panel sizes. */
function useCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  return [
    collapsed,
    (next: boolean) => {
      setCollapsed(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // A section that forgets it was folded is a cosmetic loss.
      }
    },
  ] as const;
}

function SectionHeader({
  icon,
  label,
  count,
  collapsed,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1 px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
    >
      {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && <span className="tabular-nums opacity-60">{count}</span>}
    </button>
  );
}

/** One row shared by both sections — icon, name, and the row's own menu. */
function ListRow({
  path,
  isDir,
  active,
  onOpen,
  menu,
  handle,
}: {
  path: string;
  isDir: boolean;
  active: boolean;
  onOpen: () => void;
  menu: React.ReactNode;
  /** The drag grip, when the row can be reordered. */
  handle?: React.ReactNode;
}) {
  const name = baseName(path);
  return (
    <ContextMenu>
      <Hint label={path}>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "flex w-full items-center gap-1 py-1 pr-2 pl-2 text-left transition-colors",
              active ? "bg-muted font-medium" : "hover:bg-muted/50",
            )}
          >
            {handle}
            <button
              type="button"
              onClick={onOpen}
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
            >
              {isDir ? (
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              ) : name.toLowerCase().endsWith(".html") ? (
                <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{name}</span>
            </button>
          </div>
        </ContextMenuTrigger>
      </Hint>
      {menu}
    </ContextMenu>
  );
}

function SortableShortcut({
  shortcut,
  active,
  onOpen,
  onRemove,
  onReveal,
}: {
  shortcut: DocsShortcut;
  active: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onReveal: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: shortcut.path,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1000 : 0,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
    >
      <ListRow
        path={shortcut.path}
        isDir={shortcut.is_dir}
        active={active}
        onOpen={onOpen}
        handle={
          <button
            type="button"
            className={cn(
              "shrink-0 text-muted-foreground/50 hover:text-foreground",
              isDragging ? "cursor-grabbing" : "cursor-grab",
            )}
            {...listeners}
          >
            <GripVertical className="size-3" />
            <span className="sr-only">Drag to reorder</span>
          </button>
        }
        menu={
          <ContextMenuContent>
            <ContextMenuItem onSelect={onReveal}>
              <Folder />
              Reveal in tree
            </ContextMenuItem>
            <ContextMenuItem onSelect={onRemove}>
              <StarOff />
              Remove from shortcuts
            </ContextMenuItem>
          </ContextMenuContent>
        }
      />
    </li>
  );
}

export function ShortcutsSection({
  shortcuts,
  elsewhere,
  activePath,
  onOpen,
  onReveal,
  onRemove,
  onReorder,
}: {
  /** The picked root's shortcuts only — see `shortcutsInRoot`. */
  shortcuts: DocsShortcut[];
  /** How many are starred in the *other* roots, for the empty state. */
  elsewhere: number;
  activePath: string;
  onOpen: (shortcut: DocsShortcut) => void;
  onReveal: (shortcut: DocsShortcut) => void;
  onRemove: (path: string) => void;
  onReorder: (next: DocsShortcut[]) => void;
}) {
  const [collapsed, setCollapsed] = useCollapsed("docs.shortcuts.collapsed");
  const sensors = useSensors(useSensor(PointerSensor));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = shortcuts.findIndex((s) => s.path === active.id);
    const to = shortcuts.findIndex((s) => s.path === over.id);
    if (from < 0 || to < 0) return;
    const next = [...shortcuts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  return (
    <div className="border-b">
      <SectionHeader
        icon={<Star className="size-3" />}
        label="Shortcuts"
        count={shortcuts.length}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      {!collapsed &&
        (shortcuts.length === 0 ? (
          <p className="px-2 pb-2 text-[11px] leading-relaxed text-muted-foreground">
            {/* Saying "star something" to someone who has starred plenty —
                just not in this folder — reads as if the list were lost. */}
            {elsewhere > 0
              ? `Nothing starred in this folder. ${elsewhere} ${
                  elsewhere === 1 ? "shortcut is" : "shortcuts are"
                } in the other folders.`
              : "Star a folder or a document from the tree's right-click menu to keep it here."}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={shortcuts.map((s) => s.path)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="pb-1 text-xs">
                {shortcuts.map((shortcut) => (
                  <SortableShortcut
                    key={shortcut.path}
                    shortcut={shortcut}
                    active={shortcut.path === activePath}
                    onOpen={() => onOpen(shortcut)}
                    onReveal={() => onReveal(shortcut)}
                    onRemove={() => onRemove(shortcut.path)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ))}
    </div>
  );
}

export function RecentSection({
  paths,
  activePath,
  onOpen,
  onForget,
  onClear,
}: {
  paths: string[];
  activePath: string;
  onOpen: (path: string) => void;
  onForget: (path: string) => void;
  onClear: () => void;
}) {
  const [collapsed, setCollapsed] = useCollapsed("docs.recent.collapsed");

  return (
    <div className="border-b">
      <div className="flex items-center">
        <SectionHeader
          icon={<Clock className="size-3" />}
          label="Recent files"
          count={paths.length}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
        {paths.length > 0 && (
          <Hint label="Clear the list">
            <button
              type="button"
              aria-label="Clear recent files"
              onClick={onClear}
              className="mr-1 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </Hint>
        )}
      </div>
      {!collapsed &&
        (paths.length === 0 ? (
          <p className="px-2 pb-2 text-[11px] leading-relaxed text-muted-foreground">
            Documents you open here are listed as you go.
          </p>
        ) : (
          <ul className="pb-1 text-xs">
            {paths.map((path) => (
              <li key={path}>
                <ListRow
                  path={path}
                  isDir={false}
                  active={path === activePath}
                  onOpen={() => onOpen(path)}
                  menu={
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => onForget(path)}>
                        <X />
                        Remove from the list
                      </ContextMenuItem>
                    </ContextMenuContent>
                  }
                />
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
