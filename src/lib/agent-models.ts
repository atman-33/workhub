import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

/** Claude Code's model aliases. Unlike opencode's, this catalog is static. */
export const CLAUDE_MODELS = ["haiku", "sonnet", "opus", "fable"];

// `opencode models` is a CLI spawn; fetch once per app run and share the
// result across every picker that needs it (task dialog, settings, ...).
let opencodeModelsCache: string[] | null = null;
let opencodeModelsErrorCache: string | null = null;
// `true` only while the very first fetch is in flight; reused across mounts
// (like the cache), so a second picker opened after success is instant.
let opencodeModelsLoadingCache = false;

export interface OpencodeModels {
  models: string[];
  error: string | null;
  loading: boolean;
}

/**
 * The opencode model catalog, fetched lazily and memoized for the app's
 * lifetime. Pass `active: false` while the catalog is not needed (picker
 * hidden, another agent selected) to avoid paying for the CLI spawn.
 */
export function useOpencodeModels(active: boolean): OpencodeModels {
  const [models, setModels] = useState<string[]>(opencodeModelsCache ?? []);
  const [error, setError] = useState<string | null>(opencodeModelsErrorCache);
  const [loading, setLoading] = useState<boolean>(opencodeModelsLoadingCache);

  useEffect(() => {
    if (!active || opencodeModelsCache !== null) return;
    let cancelled = false;
    opencodeModelsLoadingCache = true;
    setLoading(true);
    void api
      .opencodeModels()
      .then((fetched) => {
        opencodeModelsCache = fetched;
        opencodeModelsErrorCache = null;
        opencodeModelsLoadingCache = false;
        if (cancelled) return;
        setModels(fetched);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        opencodeModelsErrorCache = String(e);
        opencodeModelsLoadingCache = false;
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { models, error, loading };
}

// Recently-chosen opencode models (per provider/model id), most-recent first.
// Surfaced at the top of the model picker so frequently used models are one
// click away instead of scrolling the full catalog every time.
const RECENT_OPENCODE_MODELS_KEY = "workhub:opencode-recent-models";
const RECENT_OPENCODE_MODELS_MAX = 5;

function loadRecentOpencodeModels(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_OPENCODE_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((m): m is string => typeof m === "string" && !!m.trim())
      : [];
  } catch {
    return [];
  }
}

function saveRecentOpencodeModels(models: string[]): void {
  try {
    localStorage.setItem(RECENT_OPENCODE_MODELS_KEY, JSON.stringify(models));
  } catch {
    // localStorage may be unavailable/full — recent-models is a nicety.
  }
}

/** Move `model` to the front of the list, cap length, no duplicates. */
export function bumpRecentModel(prev: string[], model: string): string[] {
  const trimmed = model.trim();
  if (!trimmed) return prev;
  const next = [trimmed, ...prev.filter((m) => m !== trimmed)];
  return next.slice(0, RECENT_OPENCODE_MODELS_MAX);
}

/**
 * The recent-opencode-models list plus a recorder to push a fresh pick onto
 * it. Persisted to localStorage, so it survives restarts.
 */
export function useRecentOpencodeModels(): {
  recent: string[];
  record: (model: string) => void;
} {
  const [recent, setRecent] = useState<string[]>(() => loadRecentOpencodeModels());

  const record = useCallback((model: string) => {
    const trimmed = model.trim();
    if (!trimmed) return;
    setRecent((prev) => {
      const updated = bumpRecentModel(prev, trimmed);
      if (updated !== prev) saveRecentOpencodeModels(updated);
      return updated;
    });
  }, []);

  return { recent, record };
}
