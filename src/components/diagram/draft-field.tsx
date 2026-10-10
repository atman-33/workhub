import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Fields of the side panel that write on commit rather than on every
 * keystroke. A screen's items need it: emptying an item deletes it, so a
 * per-keystroke write would delete the item (and drop focus) the moment its
 * last character went. The memo needs it because its writer trims and drops
 * blank lines, which would eat a space typed between two words.
 *
 * The draft is committed on blur, and also when the field is unmounted
 * with a change still in it (the selection moved to another node), so a click
 * on the canvas does not lose what was typed.
 */
function useDraft(value: string, commit: (text: string) => void) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const valueRef = useRef(value);
  valueRef.current = value;
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // The file (or an undo) changed the value under the field.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (draftRef.current !== valueRef.current) commitRef.current(draftRef.current);
    },
    [],
  );

  return { draft, setDraft };
}

/** One line of text: Enter or blur commits, Escape puts the old text back. */
export function DraftInput({
  value,
  placeholder,
  itemAttr,
  onCommit,
  onEnter,
}: {
  value: string;
  placeholder?: string;
  /** Marks the input as a stop of the section's Enter-to-next walk. */
  itemAttr: string;
  /** Called with the new text when it differs from `value`. */
  onCommit: (text: string) => void;
  /** Called after Enter has committed; gets the input so it can move focus. */
  onEnter: (input: HTMLInputElement, committed: string) => void;
}) {
  const { draft, setDraft } = useDraft(value, (text) => {
    if (text !== value) onCommit(text);
  });
  // Enter commits and then moves focus away, and Escape reverts and blurs: the
  // blur that follows carries the stale draft, and committing it again would
  // delete a second item (or undo the revert).
  const skipBlur = useRef(false);
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      data-draft-item={itemAttr}
      className="h-7 text-xs"
      onChange={(e) => {
        skipBlur.current = false;
        setDraft(e.target.value);
      }}
      onBlur={() => {
        if (skipBlur.current) {
          skipBlur.current = false;
          return;
        }
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (draft !== value) onCommit(draft);
          skipBlur.current = true;
          onEnter(e.currentTarget, draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          skipBlur.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Several lines of text, committed on blur. */
export function DraftTextarea({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (text: string) => void;
}) {
  const { draft, setDraft } = useDraft(value, (text) => {
    if (text !== value) onCommit(text);
  });
  return (
    <Textarea
      value={draft}
      placeholder={placeholder}
      rows={3}
      className="resize-none text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}
