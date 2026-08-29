---
name: persona-crew
description: >
  圧縮出力の subagent への委譲判断ガイド。investigator（位置特定）、builder（1-2ファイル編集）、
  reviewer（diff レビュー）。「コンテキスト節約」「圧縮 agent」で起動。
---

Derived from genshijin (MIT, InterfaceX-co-jp) — https://github.com/InterfaceX-co-jp/genshijin

persona-crew は圧縮形式で出力する3つの subagent プリセット。役割は標準の
`Explore` / 編集系 agent / reviewer と同じで、違うのは返ってくる tool-result が
圧縮済みであること。委譲のたびに主コンテキストの消費が縮む。

**キャラクター非依存。** agent の出力は口調ではなく圧縮形式に従う。

## 使い分け

- 「X の定義はどこ / Y を呼ぶ箇所 / Z の全用法」 → `persona-investigator`
- 同上に加えてアーキテクチャの解説や提案も欲しい → `Explore`（標準）
- スコープが明確な surgical 編集、2ファイル以下 → `persona-builder`
- 新機能 / 3ファイル以上 / 横断リファクタ → 主スレッド、または `heavy-implementer`
- diff / branch / file のバグレビュー → `persona-reviewer`
- 根拠と代替案つきの深いコードレビュー → 標準の Code Reviewer
- 1行で答えが確定している内容 → 主スレッドで完結。委譲しない

判断基準は単純で、**subagent の出力を 1/3 のトークンで欲しいなら persona-crew、
散文で欲しいなら標準の agent**。

## なぜ存在するか

subagent の tool-result は主コンテキストにそのまま注入される。標準の `Explore` が
散文で 2k トークン返せば、毎回 2k を主コンテキストが負担する。同じ発見が
`persona-investigator` なら 700 トークン前後で返る。1セッションで20回委譲すると、
コンテキスト枯渇か完走かの差になる。

## 出力契約

主スレッドが agent ごとに前提にしてよい形式。

`persona-investigator`:

```text
<Header>:
- path:line — `symbol` — 短い注記
集計: <counts>。
```

該当なしは `No match.`。必ずファイルパスが先頭、行番号つき、シンボルはバッククォート。
`path:\d+` で grep できる。

`persona-builder`:

```text
<path:line-range> — <変更 10語以内>。
verified: <re-read OK | mismatch @ path:line>。
```

または終端行のいずれか: `too-big.` / `needs-confirm.` / `ambiguous.` / `regressed.`

`persona-reviewer`:

```text
path:line: <emoji> <severity>: <問題>。<修正>。
totals: N🔴 N🟡 N🔵 N❓
```

指摘なしは `No issues.`。ファイル順、ファイル内は行の昇順。

## チェイニング

**位置特定 → 修正 → 検証**（最頻）

1. `persona-investigator` で対象箇所の一覧を取る
2. 主スレッドが1〜2箇所を選び、パスを `persona-builder` に渡す
3. `persona-reviewer` が diff を監査する

**並列スカウト**（調査範囲が広いとき）

1メッセージで `persona-investigator` を2〜3個並列起動する（定義 / 呼び出し元 / テスト
のように角度を変える）。集約は主スレッドで行う。

**単発編集**（箇所が既知のとき）

investigator を飛ばし、`persona-builder` に直接 path:line を渡す。

## 禁止

- ファイルを特定せずに `persona-builder` を使わない。先に investigator を通す。
  でないと主スレッドがコンテキストを渡すためにトークンを消費する
- 5ファイル規模のリファクタで investigator → builder のチェーンを組まない。
  builder は `too-big.` を返してターンを浪費する
- `persona-reviewer` に「全般的なフィードバック」を求めない。findings しか返らない
- 散文を期待しない。persona-crew の出力は構造化されており、時に読みにくい。
  人間がそのまま読む場合は主スレッドが言い換える
