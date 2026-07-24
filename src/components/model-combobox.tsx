import { useCallback } from "react";

import { Combobox } from "@/components/ui/combobox";
import {
  CLAUDE_MODELS,
  useOpencodeModels,
  useRecentOpencodeModels,
} from "@/lib/agent-models";

interface Props {
  /** Agent the model is for: "opencode" | "claude-code" | "me". */
  assignee: string;
  value: string;
  onChange: (model: string) => void;
  /**
   * Whether the picker is currently on screen. Gates the lazy `opencode
   * models` CLI spawn, so a dialog that is closed pays nothing.
   */
  active?: boolean;
  /**
   * Render the popover as its own modal layer — required when the picker
   * lives inside a modal Radix Dialog. Every current call site does.
   */
  modal?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * Model picker for an AI agent launch, shared by the task dialog and the
 * vault-tidy and schedule settings. Which catalog is offered follows
 * `assignee`: opencode's
 * is fetched from the CLI (with recently-used ids pinned to the top), while
 * Claude Code's is a static alias list. Free text is always accepted, so a
 * model the catalog does not advertise — or one already persisted in config —
 * still round-trips.
 */
export function ModelCombobox({
  assignee,
  value,
  onChange,
  active = true,
  modal = false,
  disabled = false,
  placeholder = "agent default",
  className,
}: Props) {
  const isOpencode = assignee === "opencode";
  const { models, error, loading } = useOpencodeModels(active && isOpencode);
  const { recent, record } = useRecentOpencodeModels();

  // Filter the recent-models list down to what the current opencode catalog
  // still advertises, so a renamed/removed model doesn't linger at the top.
  // While the catalog is still loading we surface all known recents, so the
  // quick-access entry points appear immediately instead of waiting for the
  // CLI spawn to finish.
  const visibleRecent = !isOpencode
    ? []
    : models.length === 0 && loading
      ? recent
      : recent.filter((m) => models.some((o) => o === m));

  const handleChange = useCallback(
    (next: string) => {
      onChange(next);
      // Only opencode ids are worth remembering; Claude's alias list is four
      // entries and always fully visible.
      if (isOpencode) record(next);
    },
    [isOpencode, onChange, record],
  );

  return (
    <div className="space-y-1">
      <Combobox
        value={value}
        onChange={handleChange}
        options={isOpencode ? models : CLAUDE_MODELS}
        leadingOptions={visibleRecent}
        // Heading for the main options group once recents are shown, so the
        // rest of the catalog doesn't read as a continuation of "Recent".
        mainHeading="All models"
        // An opening dropdown before the catalog arrives shows a spinner so
        // the wait state is visible instead of a blank list; loading is only
        // meaningful for opencode (claude's catalog is a hard-coded array).
        loading={isOpencode && loading}
        allowCustom
        modal={modal}
        disabled={disabled}
        placeholder={placeholder}
        emptyText="No models."
        className={className}
      />
      {isOpencode && error && (
        <p className="text-[10px] text-destructive/80">
          opencode model list unavailable — {error}
        </p>
      )}
    </div>
  );
}
