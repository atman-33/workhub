// UserPromptSubmit hook: remind the agent every turn which language to reply
// in (T-0388).
//
// Static instructions alone (CLAUDE.md, memory) were not enough to stop a
// session drifting back into English partway through — this exists to
// re-assert the setting on every single turn instead of once at session
// start. See `resolveResponseLanguage` in `lib.mjs` for the settings
// precedence (vault settings.json -> app config `language` -> app config
// `task_language` -> nothing).
//
// Runs in every Claude Code session, not just vault ones (unlike most hooks
// in this plugin) — language is a property of the person, not of whichever
// repository a session happens to be working in.
//
// Must never fail or block a turn: any error here is swallowed and the hook
// exits 0 with no output, exactly like "nothing configured".
import { languageName, resolveResponseLanguage } from "./lib.mjs";

try {
  const resolved = resolveResponseLanguage();
  if (resolved?.inject && resolved.language) {
    const name = languageName(resolved.language);
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `<response-language>Reply to the user in ${name} — every message, short or long. Code, comments, commit messages and repository documents follow their own rules.</response-language>`,
        },
      }),
    );
  }
} catch {
  // Never fail the session over a settings-read hiccup.
}

process.exit(0);
