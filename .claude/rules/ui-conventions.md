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
