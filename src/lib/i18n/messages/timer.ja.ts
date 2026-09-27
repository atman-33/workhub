import type { MessageKey } from "./en";

/** Japanese strings for the Timer tab (T-0423). */
export const timerJa: Partial<Record<MessageKey, string>> = {
  "timer.finished": "時間になりました",
  "timer.notification.title": "時間になりました",
  "timer.notification.body": "{minutes}分タイマーが終了しました。",
  "timer.pause": "一時停止",
  "timer.resume": "再開",
  "timer.start": "開始",
  "timer.reset": "リセット",
  "timer.minutesSuffix": "分",
  "timer.volumeAria": "アラーム音量",
  "timer.alarmSound": "アラーム音",
  "timer.notification": "通知",
  "timer.notificationHint": "時間になったらデスクトップ通知を表示",
};
