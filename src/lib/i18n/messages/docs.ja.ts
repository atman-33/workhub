import type { MessageKey } from "./en";

/** Japanese strings for the Docs tab and its viewer window (T-0423). */
export const docsJa: Partial<Record<MessageKey, string>> = {
  "docs.tree.loading": "読み込み中…",
  "docs.tree.noMatches": "一致するものがありません。",
  "docs.tree.folderEmpty": "このフォルダは空です。",
  "docs.tree.collapse": "折りたたむ",
  "docs.tree.expand": "展開",
  "docs.tree.ariaLabel": "ドキュメント",

  "docs.entry.openWithDefaultApp": "既定のアプリで開く",
  "docs.entry.showInExplorer": "エクスプローラーで表示",
  "docs.entry.addToShortcuts": "ショートカットに追加",
  "docs.entry.copyPath": "パスをコピー",
  "docs.entry.copyPaths": "{count} 件のパスをコピー",
  "docs.entry.opensOutsideHint": "{name} — workhub の外で開きます",

  "docs.view.filterPlaceholder": "名前でフィルター",
  "docs.view.collapseAllHint": "すべてのフォルダを折りたたむ",
  "docs.view.collapseAll": "すべて折りたたむ",
  "docs.view.refreshHint": "フォルダを再読み込み（ツリーは開いたまま）",
  "docs.view.refresh": "再読み込み",
  "docs.view.openPathHint": "貼り付けたパスを開く",
  "docs.view.openPathAria": "貼り付けたパスを開く",
  "docs.view.openPathPlaceholder": "開くパスを貼り付け…",
  "docs.view.openPathAriaLabel": "開くパスを貼り付け",
  "docs.view.foundBySearch":
    "フォルダ内を検索して見つかりました — フォルダ構成が貼り付けたパスと異なります: {path}",
  "docs.view.openedByTail": "末尾一致で開きました: {path}",
  "docs.view.matchesFoundByName": "この名前のファイルが {count} 件見つかりました — 1つ選んでください。",
  "docs.view.matchesFoundByTail": "このパスの末尾に一致するファイルが {count} 件あります — 1つ選んでください。",
  "docs.view.noRootsMessage":
    "フォルダがまだ登録されていません。チームが Markdown を置いている共有フォルダ（例えば Google Drive のネットワークドライブ）を追加すると、Obsidian の vault として開かずにここでドキュメントを読めます。フォルダには一切書き込まれません。",
  "docs.view.rootUnreachable":
    "{path} はこの PC から到達できません。ドライブがマウントされているか確認し、場所が変わっている場合は上の鉛筆ボタンでパスを修正してください。",
  "docs.view.tryAgain": "再試行",

  "docs.sidebar.dragToReorder": "ドラッグして並べ替え",
  "docs.sidebar.revealInTree": "ツリーで表示",
  "docs.sidebar.removeFromShortcuts": "ショートカットから削除",
  "docs.sidebar.shortcuts": "ショートカット",
  "docs.sidebar.shortcutsEmptyElsewhere":
    "このフォルダにはスターがありません。他のフォルダに {count} 件あります。",
  "docs.sidebar.shortcutsEmpty":
    "ツリーの右クリックメニューからフォルダやドキュメントをスターすると、ここに表示されます。",
  "docs.sidebar.recentFiles": "最近使ったファイル",
  "docs.sidebar.clearListHint": "リストを消去",
  "docs.sidebar.clearRecentFiles": "最近使ったファイルを消去",
  "docs.sidebar.recentEmpty": "ここで開いたドキュメントが順に表示されます。",
  "docs.sidebar.removeFromList": "リストから削除",
  "docs.sidebar.notes": "ノート",
  "docs.sidebar.copyNotesPrompt": "ノートをプロンプトとしてコピー",
  "docs.sidebar.deleteAllNotesHint": "このドキュメントのすべてのノートを削除",
  "docs.sidebar.clearNotesAria": "ノートを消去",
  "docs.sidebar.notesEmpty": "ドキュメント内のテキストを選択して右クリックすると、変更内容をノートに残せます。",
  "docs.sidebar.notesStale": "このドキュメントは、いくつかのノートを取った後に変更されています。",
  "docs.sidebar.deleteThisNote": "このノートを削除",

  "docs.fileList.noFolderSelected": "フォルダが選択されていません",
  "docs.fileList.filesAria": "選択したフォルダ内のファイル",
  "docs.fileList.pickFolderPrompt": "ツリーでフォルダを選ぶと、中身が一覧表示されます。",
  "docs.fileList.noFiles": "このフォルダにファイルはありません。",

  "docs.preview.pickPrompt": "左側でドキュメントを選んで読んでください。",
  "docs.preview.zoomOutHint": "縮小（Ctrl+ホイール）",
  "docs.preview.zoomOut": "縮小",
  "docs.preview.resetZoomHint": "ズームをリセット",
  "docs.preview.zoomInHint": "拡大（Ctrl+ホイール）",
  "docs.preview.zoomIn": "拡大",
  "docs.preview.readingWidth": "読みやすい幅",
  "docs.preview.useFullWidth": "幅いっぱいに表示",
  "docs.preview.toggleFullWidth": "幅いっぱいに表示を切り替え",
  "docs.preview.openNewWindowHint": "新しいウィンドウで開く",
  "docs.preview.openNewWindow": "新しいウィンドウで開く",
  "docs.preview.showFileHint": "このファイルをエクスプローラーで表示",
  "docs.preview.reading": "読み込み中…",
  "docs.preview.empty": "このドキュメントは空です。",

  "docs.rootsBar.addFolderTitle": "ドキュメントフォルダを追加",
  "docs.rootsBar.pickFolder": "フォルダを選択",
  "docs.rootsBar.noFoldersRegistered": "フォルダが登録されていません",
  "docs.rootsBar.notOnThisPc": "（この PC にありません）",
  "docs.rootsBar.addHint": "参照するフォルダを登録",
  "docs.rootsBar.addAria": "フォルダを追加",
  "docs.rootsBar.editHint": "このフォルダの名前とパスを編集",
  "docs.rootsBar.editAria": "フォルダを編集",
  "docs.rootsBar.removeHint": "このフォルダの登録を解除（共有先には何も行いません）",
  "docs.rootsBar.removeAria": "フォルダを削除",
  "docs.rootsBar.settingsHint": "Docs 設定（PlantUML サーバー）",
  "docs.rootsBar.settingsAria": "Docs 設定",
  "docs.rootsBar.removeConfirmTitle": "このフォルダを削除しますか？",
  "docs.rootsBar.removeConfirmDescription":
    "「{name}」がリストから削除されます。フォルダ自体とその中身はそのまま残ります。",

  "docs.rootDialog.title": "フォルダを編集",
  "docs.rootDialog.description":
    "このフォルダは vault に記録されるので、vault を複製した別の PC でも同じフォルダが使えます。",
  "docs.rootDialog.name": "名前",
  "docs.rootDialog.namePlaceholder": "チーム共有",
  "docs.rootDialog.nameHint": "ピッカーに表示するラベルです。空にするとパスが表示されます。",
  "docs.rootDialog.folder": "フォルダ",
  "docs.rootDialog.folderPlaceholder": "G:/shared drives/team/docs",
  "docs.rootDialog.pickFolderHint": "フォルダを選択",
  "docs.rootDialog.browseAria": "フォルダを参照",
  "docs.rootDialog.pickFolderDialogTitle": "フォルダを選択",

  "docs.settings.title": "Docs 設定",
  "docs.settings.description": "フォルダの一覧と同様に vault に記録されます。",
  "docs.settings.listPaneLabel": "ツリーの横にファイル一覧を表示",
  "docs.settings.listPaneDescription":
    "Obsidian の Notebook Navigator と同じようにサイドバーを分割します: 左にフォルダ、右に選んだフォルダのファイル。オフにすると、サイドバーは1つのツリーにまとまります。",
  "docs.settings.showHiddenLabel": "ドット付きフォルダ・ファイルを表示",
  "docs.settings.showHiddenDescription":
    ".backup のようなドットで始まる名前（.git や .obsidian も含む）を一覧表示します。オフの場合は非表示です。desktop.ini はどちらでも非表示です。",
  "docs.settings.remoteImagesLabel": "https: の URL から画像を読み込む",
  "docs.settings.remoteImagesDescription":
    "オフの場合、Web を指す画像は読み込めないものとして表示されます。オンにすると取得しますが、配信元に読み込みが伝わるため、信頼できるドキュメントにのみオンにしてください。http: はどちらでも読み込まれません。",
  "docs.settings.plantumlLabel": "PlantUML サーバー",
  "docs.settings.plantumlDescription":
    "ブロックはこのサーバーで描画されます: 各図の元データがサーバーに送られ、画像が返されます。空にするとコードのまま表示され、何も送信しません。パブリックサーバー（{server}）は動作しますが第三者のサーバーです — チームのドキュメントには自前のサーバーを使うことを推奨します。",

  "docs.figure.zoomOutHint": "縮小（ホイール）",
  "docs.figure.zoomInHint": "拡大（ホイール）",
  "docs.figure.fitHint": "ウィンドウに合わせる",
  "docs.figure.fit": "ウィンドウに合わせる",
  "docs.figure.actualSizeHint": "実際のサイズ（100%）",
  "docs.figure.actualSize": "実際のサイズ",

  "docs.html.failedStyles":
    "このページが参照する {count} 件のスタイルシートを読み込めなかったため、記載どおりに見えない場合があります。",
  "docs.html.failedImages":
    "このページが参照する {count} 件の画像を読み込めなかったため、記載どおりに見えない場合があります。",
  "docs.html.failedBoth":
    "このページが参照する {styles} 件のスタイルシートと {images} 件の画像を読み込めなかったため、記載どおりに見えない場合があります。",
  "docs.html.scriptsDisabled":
    "このページのスクリプトはプレビューでは無効です。実行するには、上のツールバーから既定のアプリで開いてください。",
  "docs.html.preparingPage": "ページを準備中…",

  "docs.annotation.placeholder": "ここをどう変更しますか？",

  "docs.viewer.nothingToShow": "表示するものがありません — このウィンドウは開かれた対象を失いました。",
  "docs.viewer.windowTitleFallback": "workhub — ドキュメント",
};
