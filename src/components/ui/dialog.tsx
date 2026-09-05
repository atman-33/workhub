import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Lets a dialog's header act as a drag handle.
 *
 * Only `DialogContent draggable` provides this; `DialogHeader` picks it up so
 * the handle lives on the header without every call site having to wire it.
 */
const DialogDragContext = React.createContext<
  ((event: React.PointerEvent<HTMLElement>) => void) | null
>(null)

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Drag state for one dialog.
 *
 * A dialog is centred by a CSS transform until it is first dragged; from then
 * on it is positioned by explicit `left`/`top`, because a transform cannot be
 * combined with the open/close zoom animation without fighting it. `position`
 * is therefore null for as long as the dialog has not been moved.
 */
function useDialogDrag(enabled: boolean) {
  const node = React.useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = React.useState<{
    left: number
    top: number
  } | null>(null)
  /** Tears down the in-flight drag, if there is one. */
  const endDrag = React.useRef<(() => void) | null>(null)
  const watcher = React.useRef<MutationObserver | null>(null)

  /**
   * A callback ref rather than a ref object, because the element does not
   * exist on the first render: while the dialog is closed Radix renders
   * nothing, so an effect reading a ref object would find null and — with
   * nothing in its dependencies changing — never look again.
   *
   * The dialog also opens centred every time. Radix keeps this element mounted
   * after a close here (its exit animation never completes), so a reopen shows
   * up only as the element's own `data-state` changing; without watching it, a
   * dialog reappears wherever it was dragged to last time, possibly half off a
   * screen that has since been resized.
   */
  const ref = React.useCallback(
    (element: HTMLDivElement | null) => {
      node.current = element
      watcher.current?.disconnect()
      watcher.current = null
      if (!element || !enabled) return
      const observer = new MutationObserver(() => {
        if (element.dataset.state === "open") {
          endDrag.current?.()
          setPosition(null)
        }
      })
      observer.observe(element, { attributeFilter: ["data-state"] })
      watcher.current = observer
    },
    [enabled]
  )

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return
      // A close button or a field in the header is still itself, not a handle.
      if (
        (event.target as HTMLElement).closest(
          "button, a, input, textarea, select, [role='tab'], [contenteditable='true']"
        )
      ) {
        return
      }
      const element = node.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      // Where inside the dialog the pointer grabbed it, so the dialog does not
      // jump to put its corner under the cursor.
      const grabX = event.clientX - rect.left
      const grabY = event.clientY - rect.top
      setPosition({ left: rect.left, top: rect.top })
      event.preventDefault()

      const onMove = (move: PointerEvent) => {
        const el = node.current
        if (!el) return
        // Enough of the dialog has to stay on screen to grab it again.
        const margin = 48
        setPosition({
          left: clamp(
            move.clientX - grabX,
            margin - el.offsetWidth,
            window.innerWidth - margin
          ),
          top: clamp(move.clientY - grabY, 0, window.innerHeight - margin),
        })
      }
      const stop = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", stop)
        window.removeEventListener("pointercancel", stop)
        endDrag.current = null
      }
      // Registered here rather than from an effect keyed on a `dragging` state:
      // an effect only runs after the re-render, and a quick drag's first
      // pointermove arrives before that and would be dropped.
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", stop)
      window.addEventListener("pointercancel", stop)
      endDrag.current = stop
    },
    [enabled]
  )

  // Never leave listeners or an observer behind if the dialog goes away.
  React.useEffect(
    () => () => {
      endDrag.current?.()
      watcher.current?.disconnect()
    },
    []
  )

  return { ref, position, onPointerDown }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  draggable = false,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /**
   * Let the user move the dialog by its header.
   *
   * Off by default: a confirmation prompt or a command palette is small and
   * transient, and moving it buys nothing. It is worth it for the large,
   * long-lived dialogs the user reads against what is behind them.
   */
  draggable?: boolean
}) {
  const drag = useDialogDrag(draggable)
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        ref={drag.ref}
        className={cn(
          "fixed z-50 grid w-full max-w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          // Centred until it is dragged; pinned to explicit coordinates after.
          drag.position === null &&
            "top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]",
          className
        )}
        style={
          drag.position
            ? { ...style, left: drag.position.left, top: drag.position.top }
            : style
        }
        {...props}
      >
        <DialogDragContext.Provider value={draggable ? drag.onPointerDown : null}>
          {children}
        </DialogDragContext.Provider>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  onPointerDown,
  ...props
}: React.ComponentProps<"div">) {
  // Present only inside a draggable dialog, which is what makes the header the
  // handle without every dialog having to know about dragging.
  const startDrag = React.useContext(DialogDragContext)
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-col gap-2 text-center sm:text-left",
        // The handle reaches into the dialog's own padding: the top edge is
        // where a window is grabbed, and a band of dead space there reads as
        // the drag not working. Negative margins with matching padding change
        // nothing visually.
        startDrag && "-mx-6 -mt-6 cursor-move px-6 pt-6 select-none",
        className
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (!event.defaultPrevented) startDrag?.(event)
      }}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
