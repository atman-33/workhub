---
paths:
  - "src/**/*.tsx"
---

# UI conventions

## Tooltips: the shared `Hint` component, never the native `title`

Any tooltip the user is meant to read — hover hints on icon buttons, action
labels with their shortcut, truncation hints on a file path or an error string
— goes through `src/components/ui/hint.tsx`, which wraps the shadcn Tooltip
(`src/components/ui/tooltip.tsx`) and handles the disabled-trigger case:

```tsx
import { Hint } from "@/components/ui/hint";

<Hint label="Copy selection (Ctrl+C)">
  <Button size="icon-sm" variant="ghost" onClick={…} aria-label="Copy">
    <Copy />
  </Button>
</Hint>

// disabled controls stay hoverable; label can be undefined when there is
// nothing to say yet, in which case the child renders bare
<Hint label="Rename this schedule" disabled={!path || aiRunning}>
  <Button … disabled={!path || aiRunning} />
</Hint>
```

The native `title` attribute renders a browser-styled popup that clashes with
the app's dark theme and cannot be styled; the owner rejected it (T-0197
feedback). `aria-label` is for assistive tech, not a tooltip substitute — pair
it with a `Hint`. A component prop *named* `title` (ConfirmDialog, the help
`Section`s, project-row's `Chip`) is not a native tooltip and stays as is.

Two things to know:

- **Helper windows need their own provider.** `TooltipProvider` is mounted in
  `app.tsx`, which only covers the main window. `quick-capture`, `ink-preview`,
  `voice-indicator`, and `clips-popup` are separate React roots — mount a
  `TooltipProvider` at that window's root too (`ink-preview` and
  `voice-indicator` do). The plain overlay (`overlay.html`, no React) cannot
  use the component at all; if it ever needs a hover hint, style one with CSS.
- **Hint may wrap a radix trigger component** (`PopoverTrigger asChild`,
  `DropdownMenuTrigger asChild`, …) — Slot composition carries the handlers —
  but never put a `Hint` *inside* another trigger's `asChild` chain: `Hint`
  does not forward props/ref, so the outer trigger would lose its events.

## ResizableHandle: never pass `withHandle`

Use `<ResizableHandle />` without the `withHandle` prop everywhere in this
app. The grip icon it renders is visual clutter the owner does not want; the
bare divider is still hoverable/draggable. This applies to every
`ResizablePanelGroup` (repos view, tasks view terminal panel, and any future
split layouts).

## Resizable panels: this is not the shadcn-documented API

The `react-resizable-panels` version behind `src/components/ui/resizable.tsx`
takes different props from the ones every shadcn example (and most search
results) shows. Copying a snippet from the docs fails the typecheck with a
misleading "Property 'direction' does not exist" error:

```tsx
<ResizablePanelGroup orientation="horizontal">   {/* not `direction` */}
  <ResizablePanel id="list" defaultSize="30%" minSize="18%" className="min-h-0">
  <ResizableHandle />
  <ResizablePanel id="preview" defaultSize="70%" minSize="30%" className="min-h-0">
</ResizablePanelGroup>
```

- The group's axis prop is **`orientation`**, not `direction`.
- Sizes are **percent strings** (`"30%"`), not numbers.
- Each `ResizablePanel` needs an **`id`** — it is what layout persistence keys
  on (see `verticalLayout` in `src/components/repos-view.tsx`).
- Give panels `min-h-0` when their content scrolls, for the usual flexbox
  reason.

## Wheel gestures: register the listener yourself, non-passively

React attaches its `wheel` listener at the root **passively**, so
`e.preventDefault()` inside a JSX `onWheel` handler does nothing. A
`Ctrl + wheel` gesture then zooms the whole WebView on top of doing whatever
the handler meant to do.

When a component needs to own a wheel gesture, register it on the element by
hand and say so:

```ts
useEffect(() => {
  const el = ref.current;
  if (!el) return;
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.shiftKey) return; // leave plain scrolling alone
    e.preventDefault();
    // ...
  };
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => el.removeEventListener("wheel", onWheel);
}, [/* identity-stable callbacks only */]);
```

Two rules come with it: never take the **plain** wheel away from a scrollable
container (the schedule grid scrolls; only modified wheels change its range),
and keep the callbacks in the dependency array identity-stable (`useCallback`
with functional `setState`) so the listener is not torn down and rebuilt on
every render. See `src/components/schedule/schedule-grid.tsx`.

## Textarea that must fill, not grow: `min-h-0` + `field-sizing-fixed`

The shared `Textarea` (`src/components/ui/textarea.tsx`) carries
`field-sizing-content`, so it sizes itself to its content. That is the right
default for a form field, but it is wrong for a textarea meant to fill the
remaining height of a fixed-height layout — `h-full` alone does not stop it.

Two things break at once. The flex item wrapping the textarea defaults to
`min-height: auto`, so it cannot shrink below its content; and with no
definite height on the wrapper, `height: 100%` on the textarea cannot
resolve and falls back to content sizing. The row then grows past the
container, and whatever sits below it is clipped by the container's
`overflow-hidden` — silently, since nothing scrolls.

When the textarea should fill and scroll instead:

```tsx
<div className="relative min-h-0 flex-1">
  <Textarea className="h-full min-h-0 field-sizing-fixed resize-none overflow-auto" />
</div>
```

`min-h-0` is needed on **both** the wrapper and the textarea. This bit the
quick-capture window, where a long description hid the "Save to inbox" button
entirely (T-0102); the maximized editor in `task-dialog.tsx` uses the same
idiom. Textareas that genuinely should grow (`notes-dialog`,
`settings-dialog`, `schedule/*`) keep the default.

## Selection state: keep the id, look up the object

When a view owns a document and a side panel edits one element of it, store
only the element's **id** in state and derive the element from the document:

```ts
const [selectedId, setSelectedId] = useState<string | null>(null);
const selected = useMemo(
  () => (selectedId ? (doc?.items.find((i) => i.id === selectedId) ?? null) : null),
  [doc, selectedId],
);
```

Holding a copy of the element (`useState<Item | null>`) forks the truth. Every
edit path that does not go through the panel — a drag on the grid, a keyboard
nudge, an undo, a reload after an external file edit — updates the document
and leaves the copy behind; the panel's next patch then spreads that stale copy
back over the document and silently reverts the earlier edit. The schedule tab
shipped exactly that bug: resize a bar on the grid, then change its kind in the
panel, and the old dates came back (T-0101).

The same rule applies inside the panel: render fields straight from the `item`
prop rather than seeding a local draft from it. A draft re-seeded by
`useEffect` is the same stale copy one level down. If a field ever does need a
draft (an in-progress text edit that must not round-trip), scope it to that
field and reconcile it explicitly — do not draft the whole element.

## Scrolling a pane instead of the page: check the whole height chain

`flex-1` and `min-h-0` constrain nothing while any ancestor is still sized by
its content. A pane that asks for `min-h-0 flex-1 overflow-y-auto` will keep
growing — and the page will scroll instead — unless every ancestor up to the
shell has a height of its own.

The music view is the worked example (`src/components/music/music-view.tsx`):
the track list carried that exact class list and still did not scroll, because
the `grid lg:grid-cols-2` between it and the `h-full` root had no height. Giving
the grid `lg:min-h-0 lg:flex-1` fixed it.

Two things to keep in mind when building one:

- **Only constrain the layout that has height to share.** The two-column layout
  hands the grid the remaining height and hides the root's overflow; the
  stacked one-column layout (below `lg`) keeps scrolling the page, since
  splitting the height there would squash both halves.
- **Verify by measuring, not by looking.** `scrollHeight` vs `clientHeight` on
  the root, the pane, and the scroller says which element actually overflows;
  a screenshot cannot tell a page scrollbar from a pane scrollbar.

## Toolbar headers: information truncates, controls never shrink

A header row that mixes variable-length information (a repo name, a branch, a
status line) with action buttons is a single non-wrapping flex row. Nothing in
it shrinks by default, so long text pushes the trailing buttons past the
container's right edge, where they are simply clipped — the failure looks
intermittent because it depends on the name length and the window width.

Split such a header into two halves and say which one gives way:

```tsx
<header className="flex items-center gap-2 border-b px-3 py-2">
  <div className="flex min-w-0 flex-1 items-center gap-2">
    {/* information: `truncate` on every text node, `min-w-0` on badges */}
  </div>
  <div className="flex shrink-0 items-center gap-2">
    {/* controls: always fully visible */}
  </div>
</header>
```

- The left wrapper needs **both** `min-w-0` and `flex-1`; without `min-w-0` its
  automatic minimum size is its content and `truncate` inside it never engages.
- Icons inside a truncating element need `shrink-0` so the text, not the icon,
  is what gives way.
- The controls half takes `shrink-0` instead of relying on `ml-auto` alone —
  `ml-auto` positions the group but does not stop it being squeezed out.

The commit-graph header (`src/components/graph/git-graph-view.tsx`) shipped the
unsplit version: with a long repo name the maximize button at the end of the
row vanished (T-0186).

## A tab's root element takes `h-full`, never `flex-1`

`src/app.tsx` mounts every tab inside a plain block div:

```tsx
<div className={cn("h-full", tab !== "mindmap" && "hidden")}>
  <MindmapView … />
</div>
```

That wrapper is **not** a flex container, so `flex-1` on the tab's own root
resolves to no height at all. The root then sizes to its content, and anything
below it that needs a definite height — a `ResizablePanelGroup` above all —
collapses to a few pixels. Nothing errors; the tab just renders as a sliver.

```tsx
// correct — matches tasks-view, schedule-view, repos-view
<div className="flex h-full min-h-0 flex-col">
```

The same applies to a tab's early-return states (the "no vault configured" and
empty-state screens): they are the root for that render, so they take `h-full`
too. Inside the root, `flex-1` is right again — it is a flex item there.

The Mindmap tab shipped with `flex min-h-0 flex-1 flex-col` and rendered as a
~30px strip with the whole map clipped out of view (T-0188 follow-up). The
symptom looks like a canvas or layout bug, which is what makes it worth
recognising: check the root's height before investigating anything downstream.
