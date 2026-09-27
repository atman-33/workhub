import type { MessageKey } from "./en";

/** Japanese strings for the Ink tab and the ink preview window (T-0423). */
export const inkJa: Partial<Record<MessageKey, string>> = {
  "ink.header.title": "インク",
  "ink.header.subtitle": "Alt を二度押しして画面に描画。Alt+C でその場をキャプチャしてコピーします",
  "ink.header.refresh": "更新",

  "ink.settings.enable": "画面注釈を有効化",
  "ink.settings.saveTo": "保存先",
  "ink.settings.dirPlaceholder": "空欄 = vault の attachments/ink/",
  "ink.settings.openFolder": "フォルダを開く",

  "ink.view.loading": "読み込み中…",
  "ink.view.emptyTitle": "キャプチャはまだありません。",
  "ink.view.emptyBody":
    "{alt} を二度押しして2回目を押したままにすると描画できます。{alt} + {c} を押すと画面の内容を保存します。キャプチャは {dir} に保存されます。",

  "ink.card.openAria": "{name} を開く",
  "ink.card.copyAria": "クリップボードにコピー",
  "ink.card.revealAria": "エクスプローラーで表示",
  "ink.card.deleteAria": "削除",

  "ink.delete.title": "キャプチャを削除しますか?",
  "ink.delete.description": "「{name}」はゴミ箱に移動するため、そこから復元できます。",
  "ink.delete.confirm": "削除",

  "ink.preview.fallbackName": "インクプレビュー",
  "ink.preview.selected": "{selection} を選択中",
  "ink.preview.copySelectionHint": "選択範囲をコピー(Ctrl+C)",
  "ink.preview.copyImageHint": "画像をコピー(Ctrl+C)",
  "ink.preview.saveCropHint": "選択範囲を元の画像の隣に保存(Enter)",
  "ink.preview.clearSelectionHint": "選択範囲をクリア(Esc)",
  "ink.preview.closeHint": "閉じる(Esc)",
  "ink.preview.copyToClipboardAria": "クリップボードにコピー",
  "ink.preview.saveCropAria": "切り取りを保存",
  "ink.preview.clearSelectionAria": "選択範囲をクリア",
  "ink.preview.closeAria": "プレビューを閉じる",
  "ink.preview.footerHint":
    "ドラッグで選択 · 端をドラッグして調整 · 内側をドラッグして移動 · Ctrl+C でコピー · Enter で切り取りを保存 · Esc で選択解除、その後閉じる",
  "ink.preview.savedNote": "{name} を保存しました",
  "ink.preview.windowTitle": "workhub — インクプレビュー",
};
