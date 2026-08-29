---
name: persona-help
description: >
  persona プラグインの全コマンド・レベル・キャラクター追加手順のリファレンスカード。
  1回限りの表示で状態は変えない。「/persona-help」で起動。
---

Derived from genshijin (MIT, InterfaceX-co-jp) — https://github.com/InterfaceX-co-jp/genshijin

呼び出されたらこのリファレンスを表示する。**1回限り** — キャラクターの切替、
フラグの書き込み、設定の変更は一切しない。

キャラクター一覧は `/persona` が動的に表示する。ここでは列挙しない
（キャラクターは増減するため）。

## 切替

```text
/persona                     一覧と現在の状態
/persona <キャラクター>      キャラクター切替（レベル維持）
/persona <レベル>            レベル切替（キャラクター維持）
/persona <キャラ> <レベル>   両方
/persona <キャラ> 一時       このセッション限り
/persona off                 解除
```

レベル名はキャラクターごとに異なる。`/persona` の一覧で確認する。
内部的には `light` / `normal` / `heavy` の3段階で、圧縮の強さを表す。

- **light** — クッション言葉とぼかしを削除。文としては完結
- **normal** — 体言止め、助詞省略、キーワード列挙（既定）
- **heavy** — キーワードのみ、矢印で因果

## サブコマンド

```text
/persona-new <id>      新しいキャラクターを作る
/persona-commit        簡潔なコミットメッセージ
/persona-review        1行1指摘の PR レビュー
/persona-compress      メモリファイルの圧縮
/persona-stats         トークン使用量と推定削減量
/persona-help          このカード
```

サブコマンドはすべてキャラクター非依存。コミットメッセージや PR コメントは
リポジトリに残る文章なので、どのキャラクターでも通常の記述になる。

## 設定の保存

`一時` を付けない切替は `~/.claude/persona.json` に保存され、次回以降のセッションにも
自動で反映される。設定し直す必要はない。

優先順位:

```text
1. PERSONA_DEFAULT 環境変数   ("<キャラ>:<レベル>" または "off")
2. ~/.claude/persona.json
3. 互換パス（読み取りのみ）
4. genshijin:normal
```

環境変数が設定されていると `/persona` の保存は次回に反映されない。その場合は警告が出る。

## キャラクターの追加

`/persona-new <id>` で作成する。保存先:

```text
~/.claude/personas/<id>/character.md
```

ここはプラグイン更新の影響を受けない。プラグイン同梱の標準キャラクターは
`<プラグイン>/characters/` にあり、更新のたびに入れ替わる。

同じ id をユーザー層に置くと標準キャラクターを上書きでき、その調整は
更新で失われない。`/persona` の一覧では `標準` / `上書` / `独自` が表示される。

## statusline

現在のキャラクターをバッジ表示できる。`settings.json` に追加:

```json
"statusLine": {
  "type": "command",
  "command": "node \"<プラグインのパス>/hooks/persona-statusline.mjs\""
}
```

## 注意

persona と genshijin プラグインを同時に有効にすると、両方が毎ターン別々の口調指示を
注入するため口調が安定しない。どちらか一方を無効にする。
