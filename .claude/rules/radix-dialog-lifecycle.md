---
paths:
  - "src/components/ui/dialog.tsx"
  - "src/components/ui/*.tsx"
---

# Radix dialog lifecycle in this app (two traps)

Both cost a session an hour on T-0244. They are about `Dialog`, but the same
reasoning applies to any Radix primitive rendered through a portal with
`Presence` — `Sheet`, `Popover`, `Select`.

## A closed dialog has no element, so a ref-object effect never sees one

While the dialog is closed, Radix renders nothing inside the portal. Our
`DialogContent` wrapper still runs its hooks on that first render, so an effect
written the obvious way reads `null` and gives up:

```tsx
// WRONG — runs once, finds null, and nothing in its deps ever changes
const ref = React.useRef<HTMLDivElement | null>(null)
React.useEffect(() => {
  const element = ref.current
  if (!element) return
  observe(element)
}, [])
```

Attach to the node with a **callback ref** instead, which fires when the element
appears and again with `null` when it goes:

```tsx
const ref = React.useCallback((element: HTMLDivElement | null) => {
  node.current = element
  observer.current?.disconnect()
  observer.current = null
  if (!element) return
  observer.current = observe(element)
}, [])
```

## The content stays mounted after a close

Closing a dialog here leaves its element in the DOM with `data-state="closed"`
— its exit animation never completes, so `Presence` never unmounts it. This is
long-standing behaviour, not something a recent change introduced.

Consequences for anything that has to reset per-open state:

- **unmounting is not a signal.** State in a hook inside `DialogContent`
  survives a close and is still there on the next open;
- **`onOpenAutoFocus` is not a signal either** — Radix maps it to the focus
  scope's mount, which likewise does not happen again;
- what *does* change is the element's own `data-state`. Watch it:

```tsx
const observer = new MutationObserver(() => {
  if (element.dataset.state === "open") reset()
})
observer.observe(element, { attributeFilter: ["data-state"] })
```

`DialogContent`'s drag position uses exactly this. If you add per-open state to
a dialog, reset it the same way rather than assuming a fresh mount.
