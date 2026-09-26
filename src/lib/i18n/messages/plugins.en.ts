/** English strings for the Plugins tab (T-0423). */
export const pluginsEn = {
  "plugins.status.missing": "Required, off",
  "plugins.status.outdated": "Update available",
  "plugins.status.advised": "Recommended, off",
  "plugins.status.pending": "Installs next launch",
  "plugins.status.unknown": "Version unknown",
  "plugins.status.ok": "Up to date",
  "plugins.status.off": "Off",

  "plugins.tier.required": "Required",
  "plugins.tier.recommended": "Recommended",
  "plugins.tier.optional": "Optional",
  "plugins.tier.unlisted": "Unlisted",

  "plugins.card.contentsAria": "Contents of {name}",
  "plugins.card.notInCatalogHint": "Installed or enabled, but absent from the marketplace catalog",
  "plugins.card.notInCatalog": "Not in catalog",
  "plugins.card.notInstalled": "not installed",
  "plugins.card.onScope": "on ({scope})",
  "plugins.card.off": "off",
  "plugins.card.update": "Update",
  "plugins.card.installHintSuffix": ": fetch it now instead of at the next launch",
  "plugins.card.install": "Install",
  "plugins.card.disableHint": "Disable in the {scope} settings.json",
  "plugins.card.enableHint": "Enable in the {scope} settings.json",
  "plugins.card.installEnableHint": "Install and enable at {scope} scope",

  "plugins.view.loading": "Loading…",
  "plugins.view.title": "Plugins",
  "plugins.view.subtitle":
    "What this machine loads into a Claude Code session, and whether it is current.",
  "plugins.view.updateAllMarketplaces": "Update all marketplaces",
  "plugins.view.updatingName": "Updating {name}…",
  "plugins.view.updateName": "Update {name}",
  "plugins.view.rereadHint": "Re-read the local Claude Code state",
  "plugins.view.otherMarketplaces": "Other marketplaces",
  "plugins.view.workhubTabDescription":
    "How much this vault needs each plugin, what is installed here, and what the marketplace clone offers.",
  "plugins.view.notClonedWarningPrefix":
    "The marketplace is not cloned on this machine, so no version can be compared. Register it with",
  "plugins.view.noCatalogWarningPrefix": "The marketplace clone carries no",
  "plugins.view.noCatalogWarningSuffix":
    ", so nothing here knows which plugins are required. Update the marketplace to pick it up.",
  "plugins.view.missingPluginsOne": "{count} required plugin is switched off",
  "plugins.view.missingPluginsOther": "{count} required plugins are switched off",
  "plugins.view.missingPluginsDetail":
    "({names}). Something in the app stops working without them — a task launch, a tab's AI edit, or the repositories the app hands to an agent.",
  "plugins.view.outdatedPluginsOne": "{count} plugin is behind the marketplace clone.",
  "plugins.view.outdatedPluginsOther": "{count} plugins are behind the marketplace clone.",
  "plugins.view.suggestedPluginsOne":
    "{count} recommended plugin is off ({names}). Nothing breaks — the harness is just poorer for it.",
  "plugins.view.suggestedPluginsOther":
    "{count} recommended plugins are off ({names}). Nothing breaks — the harness is just poorer for it.",
  "plugins.view.othersTabDescriptionPrefix":
    "Plugins from every other marketplace registered on this machine. Only what is installed or switched on is listed — browsing and installing what a marketplace offers stays with",
  "plugins.view.othersTabDescriptionSuffix":
    ". None of these ship a catalog, so nothing here is called required or recommended: a plugin that is off is simply off.",
  "plugins.view.othersEmpty": "Nothing is installed or enabled from any other marketplace.",
  "plugins.view.cloneMissingWarning":
    "The clone is registered but missing from disk, so no version can be compared.",
  "plugins.view.notRegisteredWarning":
    "This marketplace is no longer registered, but its plugins are still installed — a session still loads them. Re-add it to compare versions, or uninstall them.",
  "plugins.view.resultDone": "done",
  "plugins.view.resultFailedNoOutput": "failed with no output",
  "plugins.view.footerNotePrefix":
    "Enabling, disabling and updating all take effect in the next Claude Code session — restart any session that is open. Enabled state is written to",
  "plugins.view.footerNoteMid": "(project scope) and",
  "plugins.view.footerNoteSuffix": "(user scope).",
  "plugins.view.vaultSettingsFallback": "the vault settings",
  "plugins.view.marketplaceCloneRefreshed": "clone refreshed {date}",
  "plugins.view.bulkUpdateCommand": "claude plugin marketplace update — {count} marketplaces",
  "plugins.view.commandFailed": "{command} failed",
  "plugins.view.someMarketplaceUpdatesFailedOne": "{count} of {total} marketplace update failed",
  "plugins.view.someMarketplaceUpdatesFailedOther":
    "{count} of {total} marketplace updates failed",

  "plugins.details.noDescription": "No description.",
  "plugins.details.loading": "Loading…",
  "plugins.details.enabledNotInstalled":
    "This plugin is switched on but not installed yet, so there are no contents to read. Press Install on its row to fetch it now — otherwise Claude Code fetches it on the next launch. A session that is already running picks it up after /reload-plugins or a restart.",
  "plugins.details.notInstalled":
    "Nothing is installed for this plugin on this machine, so there are no contents to read.",
  "plugins.details.tabSkills": "Skills",
  "plugins.details.tabAgents": "Agents",
  "plugins.details.tabCommands": "Commands",
  "plugins.details.tabHooks": "Hooks",
  "plugins.details.noContents":
    "This plugin ships no skills, agents, commands or hooks — whatever it contributes is not something that can be listed here.",
} as const;
