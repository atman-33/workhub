import type { MessageKey } from "./en";

/** Japanese strings for the Schedule tab (T-0423). */
export const scheduleJa: Partial<Record<MessageKey, string>> = {
  "schedule.kind.bar": "バー",
  "schedule.kind.arrow": "矢印",
  "schedule.kind.milestone": "マイルストーン",
  "schedule.kind.note": "ノート",

  "schedule.color.blue": "青",
  "schedule.color.green": "緑",
  "schedule.color.amber": "アンバー",
  "schedule.color.red": "赤",
  "schedule.color.purple": "紫",
  "schedule.color.gray": "グレー",

  "schedule.itemEditor.titlePlaceholder": "タイトル",
  "schedule.itemEditor.detailsPlaceholder": "詳細",
  "schedule.itemEditor.notePlaceholder": "メモの内容(ホバーで表示)",
  "schedule.itemEditor.noLinkedTask": "リンクするタスクなし",

  "schedule.projectCreate.title": "新規プロジェクト",
  "schedule.projectCreate.description":
    "スケジュールはプロジェクト内(vault の projects/NNNN-<slug>/ フォルダ)に置かれます。バンドルされたひな形(README、prd、roadmap など)からフォルダを作成し、NNNN の並び順番号は自動で割り当てられます。",
  "schedule.projectCreate.nameLabel": "プロジェクト名",
  "schedule.projectCreate.namePlaceholder": "例: My web app",
  "schedule.projectCreate.slugLabel": "スラッグ — projects/{folder}/(小文字のケバブケース)",
  "schedule.projectCreate.create": "プロジェクトを作成",

  "schedule.settings.hint": "スケジュール設定",
  "schedule.settings.exportFolderLabel": "HTML エクスポート先フォルダ",
  "schedule.settings.exportFolderPlaceholder": "空欄 = プロジェクトの attachments/",

  "schedule.sprint.hintActive": "スプリント: {start} から {weeks} 週間",
  "schedule.sprint.hintInactive": "タイムラインをスプリントで区切る",
  "schedule.sprint.buttonActive": "{weeks}週スプリント",
  "schedule.sprint.button": "スプリント",
  "schedule.sprint.startLabel": "スプリント1の開始日",
  "schedule.sprint.lengthLabel": "長さ",
  "schedule.sprint.turnOff": "スプリントをオフにする",
  "schedule.sprint.description":
    "タイムラインをスプリントで区切ります。周期はこのノートに保存されるため、2つのプランで異なる周期を比較できます。",
  "schedule.sprint.useTwoWeek": "2週間スプリントを使用",

  "schedule.menu.addBar": "バーを追加",
  "schedule.menu.addArrow": "矢印を追加",
  "schedule.menu.addMilestone": "マイルストーンを追加",
  "schedule.menu.addNote": "ノートを追加",
  "schedule.menu.weekendSet": "週末(weekly: 行で設定)",
  "schedule.menu.clearNonWorking": "非稼働日を解除",
  "schedule.menu.markNonWorking": "非稼働日にする",
  "schedule.menu.toggleNonWorking": "{date} の非稼働を切り替え",

  "schedule.grid.todayHint": "今日・{date}",
  "schedule.grid.moveUp": "上へ移動",
  "schedule.grid.moveDown": "下へ移動",
  "schedule.grid.selectedPrefix": "選択中",
  "schedule.grid.rightClickHint": "右クリックで要素を追加",
  "schedule.grid.clearSelection": "選択を解除",

  "schedule.timeline.selectFirst": "まずチャート上をドラッグして期間を選択してください",
  "schedule.timeline.footerHint":
    "ドラッグで移動 · Shift+ドラッグで週単位にスナップ · Shift/Ctrl + ホイールでパン/ズーム",

  "schedule.view.noVault": "スケジュールを使うには設定で vault パスを指定してください。",
  "schedule.view.pickElementHint": "要素を選んで編集してください。",
  "schedule.view.projectPlaceholder": "プロジェクト",
  "schedule.view.allProjects": "すべてのプロジェクト",
  "schedule.view.newProject": "新規プロジェクト…",
  "schedule.view.selectSchedule": "スケジュールを選択",
  "schedule.view.createHint": "{project} にスケジュールを作成",
  "schedule.view.createHintNone": "先にプロジェクトを選ぶか、スケジュールを開いてください",
  "schedule.view.newScheduleIn": "{project} に新規スケジュール",
  "schedule.view.scheduleNamePlaceholder": "スケジュール名",
  "schedule.view.aiRunningHint": "AI 編集を実行中です",
  "schedule.view.renameHint": "このスケジュールの名前を変更",
  "schedule.view.renameDescription": "vault 内のノートとファイルの名前を変更します",
  "schedule.view.rename": "名前を変更",
  "schedule.view.calendarModeHint": "週グリッド — 日単位の計画",
  "schedule.view.timelineModeHint": "長期タイムライン — 月・フェーズ・スプリント",
  "schedule.view.modeCalendar": "カレンダー",
  "schedule.view.modeTimeline": "タイムライン",
  "schedule.view.windowHint":
    "カレンダー上で Shift + ホイールでこのウィンドウを1週間移動、Ctrl + ホイールで拡大縮小",
  "schedule.view.to": "〜",
  "schedule.view.showTodayHint": "今日を表示",
  "schedule.view.presetHint": "ウィンドウ開始から{weeks}週間を表示",
  "schedule.view.reloadHint": "このスケジュールをディスクから再読み込み",
  "schedule.view.exportHint": "単一ファイルの HTML を出力",
  "schedule.view.deleteHint": "このスケジュールをゴミ箱に移動",
  "schedule.view.noProjectsTitle": "プロジェクトがまだありません",
  "schedule.view.noProjectsDescription":
    "スケジュールはプロジェクト内(vault の projects/<slug>/schedules/ フォルダ)に置かれます。最初のプロジェクトを作成して計画を始めましょう。",
  "schedule.view.createFirstProject": "最初のプロジェクトを作成",
  "schedule.view.selectPrompt":
    "スケジュールを選ぶか、プロジェクトを選んで「新規」を押してください。新しいプロジェクトはプロジェクトのドロップダウンから作成できます。",
  "schedule.view.deleteConfirmTitle": "このスケジュールをゴミ箱に移動しますか？",
  "schedule.view.deleteConfirmDescription":
    "「{title}」は vault 内の _ai/state/schedule-trash/ に移動します。削除されるわけではなく、ファイルは手動で元に戻せます。",
  "schedule.view.moveToTrash": "ゴミ箱へ移動",
  "schedule.view.movedTo": "{path} に移動しました",
  "schedule.view.exportedTo": "{path} にエクスポートしました",
  "schedule.view.noProjectFolderError": "「{project}」のプロジェクトフォルダが見つかりません",
};
