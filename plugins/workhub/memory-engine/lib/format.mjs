// Formatting for injected context blocks (kizami's timeline.py/reminder.py
// and injector.py output formats, in Japanese by design — the injected text
// is conversation context for the agent, not repository documentation).
const WEEKDAY_JA = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

function localDateParts(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}`, weekday: WEEKDAY_JA[date.getDay()] };
}

function daysBetweenLocalDates(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/** Days since the last session (local calendar days), or -1 when no data. */
export function daysSinceLast(stats) {
  if (!stats || !stats.last_session_at) return -1;
  return daysBetweenLocalDates(new Date(stats.last_session_at * 1000), new Date());
}

export function timeSummary(stats) {
  const now = localDateParts();
  const head = `## 時間サマリー\n今日: ${now.date}（${now.weekday}）${now.time}`;
  if (!stats || !stats.total_memories) {
    return `${head}\n前回のセッション: メモリなし\n総セッション数: 0件\n蓄積メモリ数: 0件`;
  }
  const last = localDateParts(new Date(stats.last_session_at * 1000));
  const days = daysSinceLast(stats);
  const ago = days > 0 ? `${days}日前` : "今日";
  return (
    `${head}\n前回のセッション: ${last.date}（${ago}）\n` +
    `総セッション数: ${stats.total_sessions}件\n蓄積メモリ数: ${stats.total_memories}件`
  );
}

export function reminder(days) {
  if (days < 3) return "";
  if (days < 7) return "## ⚠️ 3日以上経過しています\n積み残しタスクがあれば確認してください。";
  if (days < 14) {
    return "## ⚠️ 1週間以上経過しています\n前回の作業内容を確認してから始めることを推奨します。";
  }
  return "## ⚠️ 2週間以上経過しています\n大きく状況が変わっている可能性があります。タスクボードと進行中タスクを確認してください。";
}

// Injection budget per memory. user_text gets more room than assistant_text
// because the topic appears at the head of the question; both caps keep a
// 5-item injection bounded even when giant pastes were stored verbatim.
const USER_TEXT_MAX = 500;
const ASSISTANT_TEXT_MAX = 200;

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatMemories(memories, { header = "## 関連メモリ（直近7日）", full = false } = {}) {
  if (!memories.length) return `${header}\nなし`;
  const lines = [header, "（注: workhub メモリエンジンが自動取得した過去の会話の断片です）", ""];
  memories.forEach((mem, i) => {
    const date = (mem.timestamp ?? "").slice(0, 10) || "不明";
    const label = mem.task_id ? `${date} / ${mem.task_id}` : date;
    lines.push(`### ${i + 1}. ${label}`);
    lines.push(`**あなた**: ${full ? mem.user_text : clip(mem.user_text ?? "", USER_TEXT_MAX)}`);
    lines.push(`**Claude**: ${full ? mem.assistant_text : clip(mem.assistant_text ?? "", ASSISTANT_TEXT_MAX)}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}
