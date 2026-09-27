/** English strings for the Persona tab (T-0423). The setup prompt handed to a
 * Claude Code session (`SETUP_PROMPT` in persona-view.tsx) is an agent prompt
 * and stays in English, per the i18n rule. */
export const personaEn = {
  "persona.badge.custom": "Custom",
  "persona.badge.builtIn": "Built-in",

  "persona.loading": "Loading…",

  "persona.setup.title": "No persona characters found",
  "persona.setup.description":
    "This tab reads the characters shipped by the persona@workhub-marketplace plugin, plus any you wrote yourself under ~/.claude/personas/. Neither turned up, so the plugin is not installed or not enabled.",
  "persona.setup.stepTitle": "Set it up from a Claude Code session",
  "persona.setup.stepDescription":
    "Copy this prompt, paste it into a Claude Code session, and let it do the install. It registers the marketplace, installs persona, and retires the older genshijin plugin if that one is still around.",
  "persona.setup.copyPrompt": "Copy setup prompt",
  "persona.setup.genshijinWarning":
    "The standalone genshijin plugin is installed. It is what persona replaced — the setup prompt above removes it.",
  "persona.setup.alreadyInstalled": "Already installed it? Press re-scan.",
  "persona.setup.rescan": "Re-scan",

  "persona.header.enabledLabel": "Persona enabled",
  "persona.header.appliesHint":
    "Applies from the next Claude Code session. Sessions already open keep their current character.",
  "persona.header.rescanHint": "Re-scan for characters",
  "persona.header.rescanAria": "Re-scan for characters",

  "persona.genshijinBanner":
    "The standalone genshijin plugin is also installed. persona is its successor and both inject per-turn style instructions, so leaving the two enabled together styles every response twice — uninstall genshijin, or disable it in enabledPlugins.",
  "persona.envOverrideBanner":
    "PERSONA_DEFAULT is set in the environment. It wins over persona.json on read, so changes made here have no effect until it is unset.",

  "persona.sidebar.addOwn": "Add your own character",
  "persona.sidebar.runInClaudeCode": "Run this in Claude Code, then answer its questions:",
  "persona.sidebar.newCommandLabel": "/persona-new …",
  "persona.sidebar.newCommandHint":
    "It writes ~/.claude/personas/<id>/character.md. Keep custom characters there — anything placed inside the plugin folder is lost on the next plugin update.",

  "persona.detail.active": "active",
  "persona.detail.levelTitle": "Level — how much the character compresses its answers",
  "persona.detail.noSectionForLevel": "No section for this level.",
  "persona.detail.applied": "Applied",
  "persona.detail.useThisCharacter": "Use this character",
  "persona.detail.activeFromNextSession": "Active from the next session.",
  "persona.detail.takesEffectNextSession": "Takes effect the next time a session starts.",
  "persona.detail.delete": "Delete",
  "persona.detail.noneSelected": "No character selected.",

  "persona.deleteDialog.title": "Delete {name}?",
  "persona.deleteDialog.trashNote":
    "{file} goes to the recycle bin, so it can be restored from there.",
  "persona.deleteDialog.wasDefault":
    "It is the character new sessions start with, so persona is switched off as well.",
  "persona.deleteDialog.notDefault": "Sessions already open keep the character they are running.",
  "persona.deleteDialog.confirm": "Delete",
} as const;
