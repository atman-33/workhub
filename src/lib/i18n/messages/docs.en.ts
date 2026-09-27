/** English strings for the Docs tab and its viewer window (T-0423). */
export const docsEn = {
  "docs.tree.loading": "Loading…",
  "docs.tree.noMatches": "Nothing matching here.",
  "docs.tree.folderEmpty": "This folder is empty.",
  "docs.tree.collapse": "Collapse",
  "docs.tree.expand": "Expand",
  "docs.tree.ariaLabel": "Documents",

  "docs.entry.openWithDefaultApp": "Open with default app",
  "docs.entry.showInExplorer": "Show in Explorer",
  "docs.entry.addToShortcuts": "Add to shortcuts",
  "docs.entry.copyPath": "Copy path",
  "docs.entry.copyPaths": "Copy {count} paths",
  "docs.entry.opensOutsideHint": "{name} — opens outside workhub",

  "docs.view.filterPlaceholder": "Filter by name",
  "docs.view.collapseAllHint": "Collapse every folder",
  "docs.view.collapseAll": "Collapse all",
  "docs.view.refreshHint": "Re-read the folder (keeps the tree open)",
  "docs.view.refresh": "Refresh",
  "docs.view.openPathHint": "Open a pasted path",
  "docs.view.openPathAria": "Open pasted path",
  "docs.view.openPathPlaceholder": "Paste a path to open…",
  "docs.view.openPathAriaLabel": "Paste a path to open",
  "docs.view.foundBySearch":
    "Found by searching the roots — its folders differ from the pasted path: {path}",
  "docs.view.openedByTail": "Opened by tail match: {path}",
  "docs.view.matchesFoundByName": "{count} files with this name were found — pick one.",
  "docs.view.matchesFoundByTail": "{count} files match this tail — pick one.",
  "docs.view.noRootsMessage":
    "No folders registered yet. Add the shared folder your team keeps its Markdown in — a Google Drive network drive, for instance — and its documents can be read here without opening it as an Obsidian vault. Nothing is ever written into the folder.",
  "docs.view.rootUnreachable":
    "{path} is not reachable on this PC. Check that the drive is mounted and, if it lives somewhere else now, correct the path with the pencil button above.",
  "docs.view.tryAgain": "Try again",

  "docs.sidebar.dragToReorder": "Drag to reorder",
  "docs.sidebar.revealInTree": "Reveal in tree",
  "docs.sidebar.removeFromShortcuts": "Remove from shortcuts",
  "docs.sidebar.shortcuts": "Shortcuts",
  "docs.sidebar.shortcutsEmptyElsewhere":
    "Nothing starred in this folder. {count} shortcut(s) are in the other folders.",
  "docs.sidebar.shortcutsEmpty":
    "Star a folder or a document from the tree's right-click menu to keep it here.",
  "docs.sidebar.recentFiles": "Recent files",
  "docs.sidebar.clearListHint": "Clear the list",
  "docs.sidebar.clearRecentFiles": "Clear recent files",
  "docs.sidebar.recentEmpty": "Documents you open here are listed as you go.",
  "docs.sidebar.removeFromList": "Remove from the list",
  "docs.sidebar.notes": "Notes",
  "docs.sidebar.copyNotesPrompt": "Copy the notes as a prompt",
  "docs.sidebar.deleteAllNotesHint": "Delete every note on this document",
  "docs.sidebar.clearNotesAria": "Clear notes",
  "docs.sidebar.notesEmpty": "Select text in the document and right-click to note what should change.",
  "docs.sidebar.notesStale": "This document has changed since some of these notes were taken.",
  "docs.sidebar.deleteThisNote": "Delete this note",

  "docs.fileList.noFolderSelected": "No folder selected",
  "docs.fileList.filesAria": "Files in the selected folder",
  "docs.fileList.pickFolderPrompt": "Pick a folder in the tree to list what is in it.",
  "docs.fileList.noFiles": "No files in this folder.",

  "docs.preview.pickPrompt": "Pick a document on the left to read it.",
  "docs.preview.zoomOutHint": "Zoom out (Ctrl+wheel)",
  "docs.preview.zoomOut": "Zoom out",
  "docs.preview.resetZoomHint": "Reset zoom",
  "docs.preview.zoomInHint": "Zoom in (Ctrl+wheel)",
  "docs.preview.zoomIn": "Zoom in",
  "docs.preview.readingWidth": "Reading width",
  "docs.preview.useFullWidth": "Use the full width",
  "docs.preview.toggleFullWidth": "Toggle full width",
  "docs.preview.openNewWindowHint": "Open in a new window",
  "docs.preview.openNewWindow": "Open in a new window",
  "docs.preview.showFileHint": "Show this file in Explorer",
  "docs.preview.reading": "Reading…",
  "docs.preview.empty": "This document is empty.",

  "docs.rootsBar.addFolderTitle": "Add a document folder",
  "docs.rootsBar.pickFolder": "Pick a folder",
  "docs.rootsBar.noFoldersRegistered": "No folders registered",
  "docs.rootsBar.notOnThisPc": " (not on this PC)",
  "docs.rootsBar.addHint": "Register a folder to browse",
  "docs.rootsBar.addAria": "Add folder",
  "docs.rootsBar.editHint": "Edit this folder's name and path",
  "docs.rootsBar.editAria": "Edit folder",
  "docs.rootsBar.removeHint": "Forget this folder (nothing on the share is touched)",
  "docs.rootsBar.removeAria": "Remove folder",
  "docs.rootsBar.settingsHint": "Docs settings (PlantUML server)",
  "docs.rootsBar.settingsAria": "Docs settings",
  "docs.rootsBar.removeConfirmTitle": "Remove this folder?",
  "docs.rootsBar.removeConfirmDescription":
    '"{name}" is removed from the list. The folder itself and everything in it are left exactly as they are.',

  "docs.rootDialog.title": "Edit folder",
  "docs.rootDialog.description":
    "The folder is recorded in the vault, so another PC that clones it gets this folder too.",
  "docs.rootDialog.name": "Name",
  "docs.rootDialog.namePlaceholder": "Team share",
  "docs.rootDialog.nameHint": "A label for the picker. Leave it empty to show the path instead.",
  "docs.rootDialog.folder": "Folder",
  "docs.rootDialog.folderPlaceholder": "G:/shared drives/team/docs",
  "docs.rootDialog.pickFolderHint": "Pick a folder",
  "docs.rootDialog.browseAria": "Browse for the folder",
  "docs.rootDialog.pickFolderDialogTitle": "Pick the folder",

  "docs.settings.title": "Docs settings",
  "docs.settings.description": "Recorded in the vault, like the folder list.",
  "docs.settings.listPaneLabel": "File list beside the tree",
  "docs.settings.listPaneDescription":
    "Splits the sidebar the way Obsidian's Notebook Navigator does: folders on the left, the files of the folder you pick on the right. Off, the sidebar is one tree holding both.",
  "docs.settings.showHiddenLabel": "Show dot-folders and dot-files",
  "docs.settings.showHiddenDescription":
    "Lists names starting with a dot, such as .backup — and .git or .obsidian too. Off, they are hidden. desktop.ini stays hidden either way.",
  "docs.settings.remoteImagesLabel": "Load images from https: URLs",
  "docs.settings.remoteImagesDescription":
    "Off, an image pointing at the web reads as unreadable. On, the tab fetches it — which announces the read to whoever serves it, so turn it on only for documents whose sources you trust. Plain http: stays unloaded either way.",
  "docs.settings.plantumlLabel": "PlantUML server",
  "docs.settings.plantumlDescription":
    "blocks are drawn by this server: each diagram's source is sent to it and an image comes back. Leave it empty to keep them as code and send nothing. The public server ({server}) works, but it is a third party — for a team's documents, prefer a server your team runs.",

  "docs.figure.zoomOutHint": "Zoom out (wheel)",
  "docs.figure.zoomInHint": "Zoom in (wheel)",
  "docs.figure.fitHint": "Fit to window",
  "docs.figure.fit": "Fit to window",
  "docs.figure.actualSizeHint": "Actual size (100%)",
  "docs.figure.actualSize": "Actual size",

  "docs.html.failedStyles":
    "Could not read {count} stylesheet(s) this page refers to, so it may not look as written.",
  "docs.html.failedImages":
    "Could not read {count} image(s) this page refers to, so it may not look as written.",
  "docs.html.failedBoth":
    "Could not read {styles} stylesheet(s) and {images} image(s) this page refers to, so it may not look as written.",
  "docs.html.scriptsDisabled":
    "Scripts in this page are disabled in the preview. To run them, open it with the default app from the toolbar above.",
  "docs.html.preparingPage": "Preparing page…",

  "docs.annotation.placeholder": "What should change here?",

  "docs.viewer.nothingToShow": "Nothing to show — this window lost what it was opened for.",
} as const;
