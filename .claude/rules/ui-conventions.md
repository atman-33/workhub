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
