---
name: persona-stats
description: >
  現セッションの実トークン使用量と推定削減量を表示する。セッションログから直接読み取る。
  「/persona-stats」で起動。
---

Derived from genshijin (MIT, InterfaceX-co-jp) — https://github.com/InterfaceX-co-jp/genshijin

このスキルの実体は `hooks/persona-stats.mjs`。`/persona-stats` を検出した
`hooks/persona-mode-tracker.mjs` がフック内で実行し、整形済みの結果を注入する。

**モデル側で計算することは何もない。** 注入されたブロックをコードフェンスに入れて
そのまま表示するだけ。数値を自分で見積もったり、要約したりしない。

## 引数

- 引数なし — 現セッションの統計
- `--share` — 1行サマリ
- `--all` — 全セッションの集計
- `--since 7d` / `--since 24h` — 期間を区切った集計

## 数値の意味

- **出力トークン / 入力トークン / ターン数** — セッションログからの実測値
- **削減見込** — レベルごとの平均削減率からの推定値。実測ではない
- **オーバーヘッド** — SessionStart のルール注入と毎ターンのリマインダの実コスト。
  削減見込から差し引かれる
- **正味** — 削減見込 − オーバーヘッド。負の値になることもあり、その場合は
  短いセッションでルール注入のほうが高くついたことを意味する
