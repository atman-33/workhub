import type { MessageKey } from "./en";

/** Japanese strings for the Clips tab and the clips popup window (T-0423). */
export const clipsJa: Partial<Record<MessageKey, string>> = {
  "clips.header.title": "クリップ",
  "clips.header.subtitle": "キーボードから手を離さずに任意のアプリへ貼り付けられるスニペット",

  "clips.settings.enable": "ピッカーを有効化",
  "clips.settings.gesture": "ジェスチャー",
  "clips.settings.gesture.ctrlDouble": "Ctrl を二度タップ",
  "clips.settings.gesture.shiftDouble": "Shift を二度タップ",
  "clips.settings.gesture.off": "オフ",
  "clips.settings.hint":
    "修飾キーを単独で二度タップしてください — ショートカット(Ctrl+C など)の一部としてのタップではピッカーは開きません。Alt はインクオーバーレイ用に予約されています。",

  "clips.list.addSnippet": "スニペットを追加",
  "clips.list.save": "保存",
  "clips.list.saving": "保存中…",
  "clips.list.unsavedChanges": "未保存の変更があります",
  "clips.list.loading": "読み込み中…",
  "clips.list.empty":
    "スニペットはまだありません。よく打ち直す文言(アドレス、定型の返信、コマンドなど)を追加すると、どこでも Ctrl を二度タップして貼り付けられます。",

  "clips.item.dragToReorder": "ドラッグで並べ替え",
  "clips.item.labelPlaceholder": "ラベル(任意 — 空欄なら最初の行を使用)",
  "clips.item.textPlaceholder": "貼り付けるテキスト",
  "clips.item.deleteAria": "スニペットを削除",

  "clips.popup.title": "クリップ",
  "clips.popup.hint": "↑↓ 選択 · Enter 貼り付け · Ctrl+1-9 クイック選択 · Esc 閉じる",
  "clips.popup.closeAria": "閉じる",
  "clips.popup.filterPlaceholder": "絞り込み…",
  "clips.popup.emptyNone": "スニペットはまだありません — workhub のクリップタブで追加してください。",
  "clips.popup.emptyFiltered": "絞り込みに一致するスニペットがありません。",
  "clips.popup.emptyLabel": "(空)",
  "clips.popup.windowTitle": "workhub — クリップ",
};
