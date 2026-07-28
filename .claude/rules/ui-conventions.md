---
paths:
  - "src/**/*.tsx"
---

# UI conventions

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
