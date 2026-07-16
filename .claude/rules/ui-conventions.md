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
