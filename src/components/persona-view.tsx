import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, RefreshCw, User } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Markdown } from "@/components/ui/markdown";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PersonaCharacter, PersonaState } from "@/types";

/**
 * Persona tab — browses the `persona` plugin's characters and sets the one a
 * new session starts with.
 *
 * The tab writes `~/.claude/persona.json` (the persisted default) and nothing
 * else. The session flag `.persona-active` is deliberately left alone: every
 * running Claude Code session re-reads it each turn, so writing it here would
 * change the character mid-conversation in every open terminal. Hence the
 * "next session" wording on the apply button — it is the honest description of
 * what the write does, not a hedge.
 *
 * The tab is always mounted (T-0215). With no characters discovered it shows
 * the setup guidance below instead of a character list: a tab that hides
 * itself when the plugin is absent leaves the owner with nothing to read and
 * no way to find out why it vanished.
 */

/** Pasted into a Claude Code session to install the plugin and retire its
 *  predecessor. Written as a task for an agent rather than as a command list
 *  because the two install paths (the `claude plugin` CLI, and editing
 *  `settings.json`) are not equally available on every machine, and the agent
 *  can see which one works. */
const SETUP_PROMPT = `Set up the workhub \`persona\` plugin for Claude Code on this machine.

1. Register the marketplace at user scope, in the GitHub form:

   claude plugin marketplace add atman-33/workhub

   Never register the same marketplace name in both the GitHub form and the
   git-URL form. If the name is registered one way in ~/.claude/settings.json
   and the other way in ~/.claude/plugins/known_marketplaces.json, Claude Code
   ignores the marketplace wholesale and every plugin from it disappears with a
   misleading "not cached" error. Check both files and make them match.

2. Install the plugin:

   claude plugin install persona@workhub-marketplace

3. Retire the standalone \`genshijin\` plugin if it is installed. \`persona\` is
   its successor, and both inject per-turn style instructions, so having the
   two enabled at once styles every response twice:

   claude plugin uninstall genshijin

4. If the CLI is not usable here, do the same by editing ~/.claude/settings.json
   (\`extraKnownMarketplaces\` and \`enabledPlugins\`) instead.

Report what you changed and what was already in place. Then tell me to press
the re-scan button in the workhub Persona tab.`;

function OriginBadge({ origin }: { origin: PersonaCharacter["origin"] }) {
  const custom = origin === "user";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        custom ? "border-primary/40 text-primary" : "text-muted-foreground",
      )}
    >
      {custom ? "Custom" : "Built-in"}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 font-mono text-[11px]"
      onClick={() => {
        void writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label}
    </Button>
  );
}

export function PersonaView({ active }: { active: boolean }) {
  const [characters, setCharacters] = useState<PersonaCharacter[]>([]);
  const [state, setState] = useState<PersonaState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [genshijin, setGenshijin] = useState(false);

  const load = useCallback(async () => {
    const [list, current, hasGenshijin] = await Promise.all([
      api.personaCharacters(),
      api.personaState(),
      api.personaGenshijinInstalled(),
    ]);
    setCharacters(list);
    setState(current);
    setGenshijin(hasGenshijin);
    setLoaded(true);
    // Follow whatever is active on first load; afterwards leave the owner's
    // browsing selection alone so a refresh does not yank it away.
    setSelectedId((prev) => prev ?? current.character ?? list[0]?.id ?? null);
    setLevel((prev) => (prev === "normal" ? current.level : prev));
  }, []);

  useEffect(() => {
    if (active) void load().catch((e) => setError(String(e)));
  }, [active, load]);

  const selected = useMemo(
    () => characters.find((c) => c.id === selectedId) ?? null,
    [characters, selectedId],
  );

  const isActive = state?.enabled === true && state.character === selected?.id;
  const isApplied = isActive && state?.level === level;

  const apply = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setState(await api.setPersonaState(true, selected.id, level));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // Turning it back on re-applies whatever is being browsed, so the switch
      // never leaves the config enabled with no character named.
      const character = enabled ? (state?.character ?? selected?.id ?? null) : null;
      setState(await api.setPersonaState(enabled, character, enabled ? level : "normal"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  // No characters at all: the plugin is missing or disabled. Say so, and hand
  // over the prompt that fixes it — the tab used to disappear here, which told
  // the owner nothing.
  if (characters.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="max-w-2xl space-y-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <h2 className="text-sm font-medium">No persona characters found</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                This tab reads the characters shipped by the{" "}
                <code>persona@workhub-marketplace</code> plugin, plus any you wrote
                yourself under <code>~/.claude/personas/</code>. Neither turned up, so
                the plugin is not installed or not enabled.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded border p-3">
            <p className="text-xs font-medium">Set it up from a Claude Code session</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Copy this prompt, paste it into a Claude Code session, and let it do the
              install. It registers the marketplace, installs <code>persona</code>, and
              retires the older <code>genshijin</code> plugin if that one is still
              around.
            </p>
            <CopyButton text={SETUP_PROMPT} label="Copy setup prompt" />
          </div>

          {genshijin && (
            <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <span className="leading-relaxed">
                The standalone <code>genshijin</code> plugin is installed. It is what{" "}
                <code>persona</code> replaced — the setup prompt above removes it.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Already installed it? Press re-scan.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              disabled={busy}
              onClick={() => void load().catch((e) => setError(String(e)))}
            >
              <RefreshCw className="size-3.5" />
              Re-scan
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Switch
            id="persona-enabled"
            checked={state?.enabled ?? false}
            disabled={busy}
            onCheckedChange={(v) => void setEnabled(v)}
          />
          <label htmlFor="persona-enabled" className="text-sm font-medium">
            Persona enabled
          </label>
        </div>
        <span className="text-xs text-muted-foreground">
          Applies from the next Claude Code session. Sessions already open keep their
          current character.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Hint label={state?.config_path ?? ""}>
            <span className="hidden text-[11px] text-muted-foreground lg:inline">
              persona.json
            </span>
          </Hint>
          <Hint label="Re-scan for characters">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Re-scan for characters"
              disabled={busy}
              onClick={() => void load().catch((e) => setError(String(e)))}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </Hint>
        </div>
      </div>

      {genshijin && (
        <div className="flex shrink-0 items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>
            The standalone <code>genshijin</code> plugin is also installed.{" "}
            <code>persona</code> is its successor and both inject per-turn style
            instructions, so leaving the two enabled together styles every response
            twice — uninstall <code>genshijin</code>, or disable it in{" "}
            <code>enabledPlugins</code>.
          </span>
        </div>
      )}

      {state?.env_override && (
        <div className="flex shrink-0 items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>
            <code>PERSONA_DEFAULT</code> is set in the environment. It wins over
            <code> persona.json</code> on read, so changes made here have no effect until
            it is unset.
          </span>
        </div>
      )}

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 overflow-y-auto border-r py-2">
          {characters.map((c) => {
            const activeHere = state?.enabled === true && state.character === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelectedId(c.id);
                  if (activeHere && state) setLevel(state.level);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                  c.id === selectedId ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <User
                  className={cn(
                    "size-3.5 shrink-0",
                    activeHere ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  {c.source && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.source}
                    </span>
                  )}
                </span>
                <OriginBadge origin={c.origin} />
              </button>
            );
          })}
          <div className="mt-3 space-y-2 border-t px-3 pt-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Add your own character
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Run this in Claude Code, then answer its questions:
            </p>
            <CopyButton text="/persona-new my-character" label="/persona-new …" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              It writes <code>~/.claude/personas/&lt;id&gt;/character.md</code>. Keep custom
              characters there — anything placed inside the plugin folder is lost on the
              next plugin update.
            </p>
          </div>
        </div>

        {selected ? (
          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <OriginBadge origin={selected.origin} />
              {selected.source && (
                <span className="text-xs text-muted-foreground">{selected.source}</span>
              )}
              {isActive && (
                <span className="inline-flex items-center gap-1 text-xs text-primary">
                  <CheckCircle2 className="size-3.5" />
                  active
                </span>
              )}
            </div>
            <p className="mt-1 break-all text-[11px] text-muted-foreground">
              {selected.file}
            </p>

            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Level — how much the character compresses its answers
              </p>
              <div className="grid gap-2 lg:grid-cols-3">
                {selected.levels.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLevel(l.id)}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors",
                      level === l.id
                        ? "border-primary bg-primary/5"
                        : "hover:border-muted-foreground/40",
                    )}
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-sm font-medium">{l.label}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {l.id}
                      </span>
                    </span>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {l.body ? (
                        <Markdown>{l.body}</Markdown>
                      ) : (
                        <span className="italic">No section for this level.</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button size="sm" disabled={busy || isApplied} onClick={() => void apply()}>
                {isApplied ? "Applied" : "Use this character"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {isApplied
                  ? "Active from the next session."
                  : "Takes effect the next time a session starts."}
              </span>
            </div>

            {selected.sections.map((s) => (
              <div key={s.heading} className="mt-5">
                <h3 className="text-sm font-semibold">{s.heading}</h3>
                <div className="mt-1 text-sm text-muted-foreground">
                  <Markdown>{s.body}</Markdown>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 p-6 text-sm text-muted-foreground">
            No character selected.
          </div>
        )}
      </div>
    </div>
  );
}
