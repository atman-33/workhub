import * as React from "react";
import {
  Bug,
  Check,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Flame,
  Info,
  List,
  type LucideIcon,
  OctagonAlert,
  Pencil,
  Quote,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import type { CalloutKind } from "@/lib/callouts";
import { cn } from "@/lib/utils";

/** Obsidian's colour families, on the app's dark background. */
const KIND_STYLE: Record<CalloutKind, { icon: LucideIcon; box: string; title: string }> = {
  note: { icon: Pencil, box: "border-blue-500/50 bg-blue-500/10", title: "text-blue-400" },
  abstract: { icon: ClipboardList, box: "border-cyan-500/50 bg-cyan-500/10", title: "text-cyan-400" },
  info: { icon: Info, box: "border-blue-500/50 bg-blue-500/10", title: "text-blue-400" },
  todo: { icon: CircleCheck, box: "border-blue-500/50 bg-blue-500/10", title: "text-blue-400" },
  tip: { icon: Flame, box: "border-teal-500/50 bg-teal-500/10", title: "text-teal-400" },
  success: { icon: Check, box: "border-green-500/50 bg-green-500/10", title: "text-green-400" },
  question: { icon: CircleHelp, box: "border-amber-500/50 bg-amber-500/10", title: "text-amber-400" },
  warning: { icon: TriangleAlert, box: "border-orange-500/50 bg-orange-500/10", title: "text-orange-400" },
  failure: { icon: X, box: "border-red-500/50 bg-red-500/10", title: "text-red-400" },
  danger: { icon: Zap, box: "border-red-500/50 bg-red-500/10", title: "text-red-400" },
  bug: { icon: Bug, box: "border-red-500/50 bg-red-500/10", title: "text-red-400" },
  example: { icon: List, box: "border-purple-500/50 bg-purple-500/10", title: "text-purple-400" },
  quote: { icon: Quote, box: "border-zinc-500/50 bg-zinc-500/10", title: "text-zinc-400" },
};

/** The untitled NotePM/Zenn boxes read better with the "stop" glyph for danger. */
const UNTITLED_ICON: Partial<Record<CalloutKind, LucideIcon>> = {
  danger: OctagonAlert,
};

interface CalloutState {
  kind: CalloutKind;
  type: string;
  foldable: boolean;
  open: boolean;
  toggle: () => void;
}

const CalloutContext = React.createContext<CalloutState | null>(null);

function titleCase(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * The box around a callout — `div[data-callout]` from `rehypeCallouts`.
 * Folding (`[!note]-` / `[!note]+`) is React state rather than a `<details>`,
 * which the document styling already dresses as a bordered disclosure.
 */
export function CalloutBox({
  kind,
  type,
  fold,
  noTitle,
  children,
}: {
  kind: CalloutKind;
  type: string;
  fold?: string;
  noTitle: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(fold !== "-");
  const style = KIND_STYLE[kind];
  const state = React.useMemo<CalloutState>(
    () => ({ kind, type, foldable: !!fold, open, toggle: () => setOpen((value) => !value) }),
    [kind, type, fold, open],
  );

  if (noTitle) {
    const Icon = UNTITLED_ICON[kind] ?? style.icon;
    return (
      <div
        className={cn("my-4 flex gap-3 rounded-md border-l-4 px-4 py-3", style.box)}
        data-callout={kind}
      >
        <Icon className={cn("mt-1.5 size-4 shrink-0", style.title)} aria-hidden />
        <div className="min-w-0 flex-1">
          <CalloutContext.Provider value={state}>{children}</CalloutContext.Provider>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("my-4 rounded-md border-l-4 px-4 py-2", style.box)} data-callout={kind}>
      <CalloutContext.Provider value={state}>{children}</CalloutContext.Provider>
    </div>
  );
}

/** `div[data-callout-title]`: the icon and title line, and the fold toggle. */
export function CalloutTitle({ children }: { children: React.ReactNode }) {
  const state = React.useContext(CalloutContext);
  if (!state) return <div>{children}</div>;
  const style = KIND_STYLE[state.kind];
  const Icon = style.icon;
  const empty = React.Children.count(children) === 0;
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{empty ? titleCase(state.type) : children}</span>
      {state.foldable && (
        <ChevronRight
          className={cn("size-4 shrink-0 transition-transform", state.open && "rotate-90")}
          aria-hidden
        />
      )}
    </>
  );
  const className = cn("flex items-center gap-2 py-1 font-semibold", style.title);
  if (!state.foldable) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={state.toggle}
      aria-expanded={state.open}
      className={cn(className, "w-full cursor-pointer text-left")}
    >
      {content}
    </button>
  );
}

/** `div[data-callout-body]`: the callout's content, hidden while folded. */
export function CalloutBody({ children }: { children: React.ReactNode }) {
  const state = React.useContext(CalloutContext);
  if (state && !state.open) return null;
  if (React.Children.count(children) === 0) return null;
  return <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>;
}
