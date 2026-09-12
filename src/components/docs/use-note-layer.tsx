import { useCallback, useEffect, useRef, useState } from "react";
import { AnnotationPopover, type PopoverAnchor } from "@/components/docs/annotation-popover";
import { type Anchor, captureAnchor, findRange } from "@/lib/docs/annotation-range";
import { paintNoteHighlights } from "@/lib/docs/annotation-highlight";
import type { DocNote } from "@/lib/docs/annotations";

/**
 * What the pane needs from its owner to take notes on a document (T-0299).
 *
 * The notes themselves live in the Docs view, which knows the root and the
 * path within it — the two halves of their storage key. The pane only knows
 * the rendered document, so it reports what was selected and is handed back
 * the list to draw.
 */
export interface DocNotesPane {
  notes: DocNote[];
  add: (note: Omit<DocNote, "id" | "createdAt">) => void;
  update: (id: string, comment: string) => void;
  remove: (id: string) => void;
  /**
   * Told the `contentStamp` of the text currently on screen. The owner needs
   * it to say whether the notes were taken against this version, and only the
   * pane has the text.
   */
  onStamp?: (stamp: string) => void;
  /** A note the sidebar asked to show; cleared through `onRevealed`. */
  reveal?: string;
  onRevealed?: () => void;
}

interface Options {
  /** Absent, or a document with no root, turns the whole layer off. */
  api?: DocNotesPane;
  /** The element whose text can be annotated. */
  getRoot: () => HTMLElement | null;
  /**
   * The document to listen on — the pane's own for Markdown and text, the
   * frame's for an HTML page. Null until it exists.
   */
  getDoc: () => Document | null;
  /**
   * Viewport offset of that document inside this window: zero for the pane's
   * own, the frame's top-left for a framed one.
   */
  getOffset?: () => PopoverAnchor;
  /** `contentStamp` of the text on screen, recorded with each new note. */
  stamp: string;
  /** Changes whenever the rendered DOM has been replaced. */
  version: unknown;
}

type Open =
  | { kind: "new"; at: PopoverAnchor; anchor: Anchor }
  | { kind: "edit"; at: PopoverAnchor; note: DocNote };

/**
 * The note-taking layer over a rendered document: right-click to comment on
 * the selection, click a noted passage to edit it, and the highlights that
 * show which passages carry one.
 *
 * **Why a right-click with no menu in between.** A right-click on a selection
 * has no other meaning here, so a menu step would only add a click. It also
 * keeps one implementation for both panes: Radix's `ContextMenu` never sees a
 * `contextmenu` raised inside the HTML preview's frame, because the event does
 * not leave the frame, so a menu would have to be built twice.
 *
 * **Why the selection is read on `contextmenu`.** Focusing the comment box
 * collapses it. Capturing the anchor when the note is saved reads an empty
 * range — the bug this comment exists to prevent.
 */
export function useNoteLayer({ api, getRoot, getDoc, getOffset, stamp, version }: Options) {
  const [open, setOpen] = useState<Open | null>(null);
  // Read inside native listeners, which are attached once per document.
  const latest = useRef({ api, getRoot, getOffset });
  latest.current = { api, getRoot, getOffset };

  const close = useCallback(() => setOpen(null), []);

  const doc = getDoc();
  const enabled = !!api;

  // Right-click to comment, click to edit, and close on scroll — a popover
  // placed against a range cannot follow it, and pretending otherwise puts the
  // bubble somewhere the passage no longer is.
  useEffect(() => {
    if (!doc || !enabled) return;

    const offsetNow = () => latest.current.getOffset?.() ?? { x: 0, y: 0 };

    const onContextMenu = (e: MouseEvent) => {
      const root = latest.current.getRoot();
      // The listener is on the document, so it also hears clicks elsewhere in
      // the window — the tree, the toolbar. Only the rendered document counts.
      if (!root || !isWithin(root, e.target)) return;
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const anchor = captureAnchor(root, range);
      if (!anchor) return;
      e.preventDefault();
      const rect = range.getBoundingClientRect();
      const offset = offsetNow();
      setOpen({
        kind: "new",
        at: { x: rect.left + offset.x, y: rect.bottom + offset.y },
        anchor,
      });
    };

    const onClick = (e: MouseEvent) => {
      const root = latest.current.getRoot();
      const notes = latest.current.api?.notes ?? [];
      if (!root || notes.length === 0 || !isWithin(root, e.target)) return;
      // A highlight is painted, not an element, so it cannot be the click
      // target. The caret under the pointer is what says which passage was
      // clicked.
      const caret = caretRangeAt(doc, e.clientX, e.clientY);
      if (!caret) return;
      for (const note of notes) {
        const range = findRange(root, note);
        if (!range) continue;
        if (range.isPointInRange(caret.startContainer, caret.startOffset)) {
          const rect = range.getBoundingClientRect();
          const offset = offsetNow();
          setOpen({
            kind: "edit",
            at: { x: rect.left + offset.x, y: rect.bottom + offset.y },
            note,
          });
          return;
        }
      }
    };

    doc.addEventListener("contextmenu", onContextMenu);
    doc.addEventListener("click", onClick);
    doc.defaultView?.addEventListener("scroll", close, true);
    return () => {
      doc.removeEventListener("contextmenu", onContextMenu);
      doc.removeEventListener("click", onClick);
      doc.defaultView?.removeEventListener("scroll", close, true);
    };
  }, [doc, enabled, close]);

  // The ranges have to be re-derived whenever the rendered tree is replaced:
  // the old ones point at nodes that are no longer in the document.
  const notes = api?.notes;
  useEffect(() => {
    const root = getRoot();
    if (!root || !doc || !notes) return;
    const ranges: Range[] = [];
    for (const note of notes) {
      const range = findRange(root, note);
      if (range) ranges.push(range);
    }
    paintNoteHighlights(doc, ranges);
    return () => paintNoteHighlights(doc, []);
    // `version` stands for the rendered DOM; `getRoot` is a stable ref reader.
  }, [notes, doc, version, getRoot]);

  // Scroll a note into view when the sidebar asks for it.
  const reveal = api?.reveal;
  const onRevealed = api?.onRevealed;
  useEffect(() => {
    if (!reveal || !notes) return;
    const root = getRoot();
    const note = notes.find((n) => n.id === reveal);
    const range = note && root ? findRange(root, note) : null;
    const target =
      range?.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range?.startContainer.parentElement;
    target?.scrollIntoView({ block: "center" });
    onRevealed?.();
  }, [reveal, notes, getRoot, onRevealed]);

  useEffect(() => {
    // A different document, or a re-render, invalidates an open bubble.
    close();
  }, [version, close]);

  if (!api || !open) return null;

  return (
    <AnnotationPopover
      key={open.kind === "edit" ? open.note.id : `${open.at.x},${open.at.y}`}
      at={open.at}
      quote={open.kind === "edit" ? open.note.quote : open.anchor.quote}
      value={open.kind === "edit" ? open.note.comment : ""}
      onCancel={close}
      onDelete={
        open.kind === "edit"
          ? () => {
              api.remove(open.note.id);
              close();
            }
          : undefined
      }
      onSave={(comment) => {
        if (!comment.trim()) return;
        if (open.kind === "edit") api.update(open.note.id, comment.trim());
        else api.add({ ...open.anchor, comment: comment.trim(), stamp });
        close();
      }}
    />
  );
}

/** True when an event target sits inside the annotatable subtree. */
function isWithin(root: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && root.contains(target);
}

/** `caretRangeFromPoint`, across the two spellings browsers ship it under. */
function caretRangeAt(doc: Document, x: number, y: number): Range | null {
  const legacy = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof legacy.caretRangeFromPoint === "function") return legacy.caretRangeFromPoint(x, y);
  const modern = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const position = modern.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = doc.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}
