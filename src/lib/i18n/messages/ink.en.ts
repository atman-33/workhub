/** English strings for the Ink tab and the ink preview window (T-0423). */
export const inkEn = {
  "ink.header.title": "Ink",
  "ink.header.subtitle": "Draw on screen with a double-press of Alt; Alt+C saves the shot and copies it",
  "ink.header.refresh": "Refresh",

  "ink.settings.enable": "Enable screen annotation",
  "ink.settings.saveTo": "Save to",
  "ink.settings.dirPlaceholder": "blank = the vault's attachments/ink/",
  "ink.settings.openFolder": "Open folder",

  "ink.view.loading": "Loading…",
  "ink.view.emptyTitle": "No captures yet.",
  "ink.view.emptyBody":
    "Double-press {alt} and hold the second press to draw, then press {alt} + {c} to save what is on screen. Captures land in {dir}.",

  "ink.card.openAria": "Open {name}",
  "ink.card.copyAria": "Copy to clipboard",
  "ink.card.revealAria": "Show in Explorer",
  "ink.card.deleteAria": "Delete",

  "ink.delete.title": "Delete capture?",
  "ink.delete.description":
    '"{name}" goes to the recycle bin, so it can be restored from there.',
  "ink.delete.confirm": "Delete",

  "ink.preview.fallbackName": "Ink preview",
  "ink.preview.selected": "{selection} selected",
  "ink.preview.copySelectionHint": "Copy selection (Ctrl+C)",
  "ink.preview.copyImageHint": "Copy image (Ctrl+C)",
  "ink.preview.saveCropHint": "Save the selection beside the original (Enter)",
  "ink.preview.clearSelectionHint": "Clear the selection (Esc)",
  "ink.preview.closeHint": "Close (Esc)",
  "ink.preview.copyToClipboardAria": "Copy to clipboard",
  "ink.preview.saveCropAria": "Save crop",
  "ink.preview.clearSelectionAria": "Clear selection",
  "ink.preview.closeAria": "Close preview",
  "ink.preview.footerHint":
    "Drag to select · drag its edges to adjust · drag inside to move · Ctrl+C copies · Enter saves the crop · Esc clears, then closes",
  "ink.preview.savedNote": "Saved {name}",
  "ink.preview.windowTitle": "workhub — ink preview",
} as const;
