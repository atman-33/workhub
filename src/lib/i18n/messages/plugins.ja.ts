import type { MessageKey } from "./en";

/** Japanese strings for the Plugins tab (T-0423). */
export const pluginsJa: Partial<Record<MessageKey, string>> = {
  "plugins.status.missing": "必須・オフ",
  "plugins.status.outdated": "更新あり",
  "plugins.status.advised": "推奨・オフ",
  "plugins.status.pending": "次回起動時にインストール",
  "plugins.status.unknown": "バージョン不明",
  "plugins.status.ok": "最新",
  "plugins.status.off": "オフ",

  "plugins.tier.required": "必須",
  "plugins.tier.recommended": "推奨",
  "plugins.tier.optional": "任意",
  "plugins.tier.unlisted": "未掲載",

  "plugins.card.contentsAria": "{name} の内容",
  "plugins.card.notInCatalogHint": "インストールまたは有効化されていますが、マーケットプレイスのカタログにはありません",
  "plugins.card.notInCatalog": "カタログ外",
  "plugins.card.notInstalled": "未インストール",
  "plugins.card.onScope": "オン（{scope}）",
  "plugins.card.off": "オフ",
  "plugins.card.update": "更新",
  "plugins.card.installHintSuffix": ": 次回起動を待たずに今すぐ取得します",
  "plugins.card.install": "インストール",
  "plugins.card.disableHint": "{scope} の settings.json で無効化します",
  "plugins.card.enableHint": "{scope} の settings.json で有効化します",
  "plugins.card.installEnableHint": "{scope} スコープでインストールして有効化します",

  "plugins.view.loading": "読み込み中…",
  "plugins.view.title": "プラグイン",
  "plugins.view.subtitle": "この端末が Claude Code セッションに読み込むもの、そしてそれが最新かどうか。",
  "plugins.view.updateAllMarketplaces": "すべてのマーケットプレイスを更新",
  "plugins.view.updatingName": "{name} を更新中…",
  "plugins.view.updateName": "{name} を更新",
  "plugins.view.rereadHint": "ローカルの Claude Code 状態を再読み込み",
  "plugins.view.otherMarketplaces": "他のマーケットプレイス",
  "plugins.view.workhubTabDescription":
    "この vault が各プラグインをどれだけ必要としているか、ここに何がインストールされているか、マーケットプレイスのクローンが何を提供しているか。",
  "plugins.view.notClonedWarningPrefix":
    "マーケットプレイスがこの端末にクローンされていないため、バージョンを比較できません。次のコマンドで登録してください:",
  "plugins.view.noCatalogWarningPrefix": "マーケットプレイスのクローンに",
  "plugins.view.noCatalogWarningSuffix":
    "がなく、どのプラグインが必須かここではわかりません。マーケットプレイスを更新して取得してください。",
  "plugins.view.missingPluginsOne": "必須プラグインが{count}件オフになっています",
  "plugins.view.missingPluginsOther": "必須プラグインが{count}件オフになっています",
  "plugins.view.missingPluginsDetail":
    "（{names}）。これらがないと、タスクの起動、タブの AI 編集、アプリがエージェントに渡すリポジトリなど、アプリの一部が動作しなくなります。",
  "plugins.view.outdatedPluginsOne": "{count}件のプラグインがマーケットプレイスのクローンより古い状態です。",
  "plugins.view.outdatedPluginsOther": "{count}件のプラグインがマーケットプレイスのクローンより古い状態です。",
  "plugins.view.suggestedPluginsOne":
    "推奨プラグインが{count}件オフです（{names}）。何も壊れませんが、ハーネスの機能が少し弱くなります。",
  "plugins.view.suggestedPluginsOther":
    "推奨プラグインが{count}件オフです（{names}）。何も壊れませんが、ハーネスの機能が少し弱くなります。",
  "plugins.view.othersTabDescriptionPrefix":
    "この端末に登録されている他のすべてのマーケットプレイスのプラグインです。表示されるのはインストールまたはオンになっているものだけです — マーケットプレイスが提供するものの閲覧やインストールは",
  "plugins.view.othersTabDescriptionSuffix":
    "で行います。これらはどれもカタログを持たないため、ここでは必須・推奨という分類は行われません — オフのプラグインは単にオフです。",
  "plugins.view.othersEmpty": "他のマーケットプレイスからインストールまたは有効化されているものはありません。",
  "plugins.view.cloneMissingWarning":
    "クローンは登録されていますがディスク上に見つからないため、バージョンを比較できません。",
  "plugins.view.notRegisteredWarning":
    "このマーケットプレイスはもう登録されていませんが、そのプラグインはまだインストールされています — セッションは引き続き読み込みます。バージョンを比較するには再登録するか、アンインストールしてください。",
  "plugins.view.resultDone": "完了",
  "plugins.view.resultFailedNoOutput": "失敗（出力なし）",
  "plugins.view.footerNotePrefix":
    "有効化・無効化・更新はすべて次の Claude Code セッションから反映されます — 開いているセッションは再起動してください。有効状態は",
  "plugins.view.footerNoteMid": "（プロジェクトスコープ）と",
  "plugins.view.footerNoteSuffix": "（ユーザースコープ）に書き込まれます。",
  "plugins.view.vaultSettingsFallback": "vault の設定",
  "plugins.view.marketplaceCloneRefreshed": "クローン更新: {date}",
  "plugins.view.bulkUpdateCommand": "claude plugin marketplace update — マーケットプレイス{count}件",
  "plugins.view.commandFailed": "{command} が失敗しました",
  "plugins.view.someMarketplaceUpdatesFailedOne":
    "{total}件中{count}件のマーケットプレイス更新が失敗しました",
  "plugins.view.someMarketplaceUpdatesFailedOther":
    "{total}件中{count}件のマーケットプレイス更新が失敗しました",

  "plugins.details.noDescription": "説明はありません。",
  "plugins.details.loading": "読み込み中…",
  "plugins.details.enabledNotInstalled":
    "このプラグインはオンになっていますが、まだインストールされていないため読み取れる内容がありません。行の「インストール」を押すと今すぐ取得できます — それ以外の場合は次回起動時に Claude Code が取得します。すでに実行中のセッションは /reload-plugins または再起動後に反映されます。",
  "plugins.details.notInstalled":
    "この端末にはこのプラグインが何もインストールされていないため、読み取れる内容がありません。",
  "plugins.details.tabSkills": "スキル",
  "plugins.details.tabAgents": "エージェント",
  "plugins.details.tabCommands": "コマンド",
  "plugins.details.tabHooks": "フック",
  "plugins.details.noContents":
    "このプラグインはスキル・エージェント・コマンド・フックのいずれも含んでいません — 提供している内容はここには一覧できません。",
};
