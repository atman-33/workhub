import type { MessageKey } from "./en";

/** Japanese strings for the Persona tab (T-0423). */
export const personaJa: Partial<Record<MessageKey, string>> = {
  "persona.badge.custom": "カスタム",
  "persona.badge.builtIn": "ビルトイン",

  "persona.loading": "読み込み中…",

  "persona.setup.title": "persona のキャラクターが見つかりません",
  "persona.setup.description":
    "このタブは persona@workhub-marketplace プラグインが提供するキャラクターと、~/.claude/personas/ に自分で書いたキャラクターを読み込みます。どちらも見つからなかったため、プラグインがインストールされていないか無効になっています。",
  "persona.setup.stepTitle": "Claude Code セッションからセットアップ",
  "persona.setup.stepDescription":
    "このプロンプトをコピーして Claude Code セッションに貼り付けると、インストールを行ってくれます。マーケットプレイスの登録、persona のインストール、そして古い genshijin プラグインが残っていればその引退までを行います。",
  "persona.setup.copyPrompt": "セットアッププロンプトをコピー",
  "persona.setup.genshijinWarning":
    "単体の genshijin プラグインがインストールされています。これは persona に置き換えられたもので、上のセットアッププロンプトで削除されます。",
  "persona.setup.alreadyInstalled": "すでにインストール済みですか?再スキャンを押してください。",
  "persona.setup.rescan": "再スキャン",

  "persona.header.enabledLabel": "Persona 有効",
  "persona.header.appliesHint":
    "次の Claude Code セッションから反映されます。すでに開いているセッションは現在のキャラクターを保持します。",
  "persona.header.rescanHint": "キャラクターを再スキャン",
  "persona.header.rescanAria": "キャラクターを再スキャン",

  "persona.genshijinBanner":
    "単体の genshijin プラグインも同時にインストールされています。persona はその後継で、両方とも毎ターンのスタイル指示を注入するため、両方を有効にしたままだと応答のスタイルが二重に適用されます — genshijin をアンインストールするか、enabledPlugins で無効にしてください。",
  "persona.envOverrideBanner":
    "環境変数 PERSONA_DEFAULT が設定されています。読み込み時に persona.json より優先されるため、それが解除されるまでここでの変更は反映されません。",

  "persona.sidebar.addOwn": "自分のキャラクターを追加",
  "persona.sidebar.runInClaudeCode": "Claude Code でこれを実行し、質問に答えてください:",
  "persona.sidebar.newCommandLabel": "/persona-new …",
  "persona.sidebar.newCommandHint":
    "~/.claude/personas/<id>/character.md に書き込まれます。カスタムキャラクターはここに置いてください — プラグインフォルダ内に置いたものは次回のプラグイン更新で失われます。",

  "persona.detail.active": "使用中",
  "persona.detail.levelTitle": "レベル — キャラクターが応答をどれだけ圧縮するか",
  "persona.detail.noSectionForLevel": "このレベル用のセクションはありません。",
  "persona.detail.applied": "適用済み",
  "persona.detail.useThisCharacter": "このキャラクターを使用",
  "persona.detail.activeFromNextSession": "次のセッションから有効になります。",
  "persona.detail.takesEffectNextSession": "次回セッション開始時に反映されます。",
  "persona.detail.delete": "削除",
  "persona.detail.noneSelected": "キャラクターが選択されていません。",

  "persona.deleteDialog.title": "{name} を削除しますか?",
  "persona.deleteDialog.trashNote": "{file} はゴミ箱に移動するため、そこから復元できます。",
  "persona.deleteDialog.wasDefault":
    "これは新しいセッションが開始時に使うキャラクターのため、persona も同時にオフになります。",
  "persona.deleteDialog.notDefault": "すでに開いているセッションは実行中のキャラクターを保持します。",
  "persona.deleteDialog.confirm": "削除",
};
