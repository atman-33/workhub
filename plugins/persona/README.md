# persona

応答の口調をキャラクターとして切り替えるプラグイン。トークン削減の共通エンジンを
1つ持ち、キャラクターは差し替え可能なファイルとして定義する。

genshijin (MIT / InterfaceX-co-jp) の派生。詳細は [NOTICE.md](NOTICE.md)。

## 何ができるか

```text
/persona                     一覧と現在の状態
/persona noctis              キャラクター切替（レベルは維持）
/persona 無口                レベル切替（キャラクターは維持）
/persona lunafreya 簡潔      両方
/persona noctis 一時         このセッション限り
/persona off                 解除
```

同梱キャラクター:

| id | 名前 | 出典 | light | normal | heavy |
|---|---|---|---|---|---|
| `genshijin` | 原始人 | genshijin | 丁寧 | 通常 | 極限 |
| `noctis` | ノクティス | ファイナルファンタジーXV | 軽口 | 通常 | 無口 |
| `lunafreya` | ルナフレーナ | ファイナルファンタジーXV | 丁寧 | 簡潔 | 静謐 |

ゲーム内のセリフ・画像・ロゴは含まない。口調の特徴のみを記述している。

`lunafreya` は敬語を基調とするため、圧縮率は他の2キャラクターより低い。
これはキャラクター性を優先した意図的な設計で、削減を最優先するなら
`/persona genshijin 極限` を使う。

## 設定は保存される

`一時` を付けない切替は `~/.claude/persona.json` に保存され、次回以降のセッションにも
自動で反映される。毎回設定し直す必要はない。

優先順位:

1. `PERSONA_DEFAULT` 環境変数（`<キャラクター>:<レベル>` または `off`）
2. `~/.claude/persona.json`
3. 互換パス（読み取りのみ）: `$XDG_CONFIG_HOME/persona/config.json`,
   `~/.config/persona/config.json`, `%APPDATA%\persona\config.json`
4. `genshijin:normal`

環境変数が設定されていると、`/persona` で保存しても次回に反映されない。
その場合は切替時に警告が出る。

## キャラクターの追加

`/persona-new <id>` で作る。保存先は:

```text
~/.claude/personas/<id>/character.md
```

**この場所はプラグイン更新の影響を受けない。**

| 層 | 場所 | 更新時 |
|---|---|---|
| 標準キャラクター | `<プラグイン>/characters/` | プラグイン更新で入れ替わる（改善が届く） |
| ユーザーキャラクター | `~/.claude/personas/` | 影響を受けない |

プラグインは `~/.claude/plugins/cache/<marketplace>/persona/<version>/` に
**バージョン別ディレクトリ**で展開されるため、プラグイン配下に置いたファイルは
次の更新で引き継がれない。ユーザー独自のキャラクターは必ずユーザー層に置く。

同じ id をユーザー層に置くと標準キャラクターを上書きでき、その調整は更新で失われない。
`/persona` の一覧では出所が `標準` / `上書` / `独自` で表示される。上書きした場合は
標準側が改善されても取り込まれないため、`based_on: <id>@<version>` を記録しておくと
一覧に差分が表示される。

テンプレートは `characters/_template/character.md`。手で作る場合はこれをコピーする。

## コンテキストのコスト

このプラグインは「選択中のキャラクターの、選択中のレベル」だけを注入する。
他のキャラクターや他のレベルの定義は一切コンテキストに載らない。

実測値:

- **SessionStart（1回）**: 7.0 – 8.5 KB（キャラクターとレベルによる）
- **毎ターン**: 207 バイト（`character.md` の `reminder` 1行のみ）

毎ターンの注入を極小にしているのは、長いセッションではそちらが支配的なコストに
なるため。SessionStart の完全な定義は1回で済むが、毎ターンのリマインダは
ターン数だけ積み上がる。

固定コストとして、スキル8個とエージェント3個の `description` は persona が
無効でも常にシステムプロンプトに載る。そのため各 description は1〜2行に抑えている。

`/persona-stats` で実測トークン量と推定削減量を確認できる。表示される
「オーバーヘッド」が上記の注入コストで、削減見込から差し引かれた正味が出る。

## サブコマンド

すべて**キャラクター非依存**。コミットメッセージや PR コメントはリポジトリに残る
文章なので、どのキャラクターが有効でも通常の記述になる。

```text
/persona-new <id>      新しいキャラクターを作る
/persona-commit        簡潔なコミットメッセージ
/persona-review        1行1指摘の PR レビュー
/persona-compress      メモリファイルの圧縮
/persona-stats         トークン使用量と推定削減量
/persona-help          リファレンスカード
/persona-crew          圧縮出力 subagent への委譲判断
```

エージェント `persona-investigator` / `persona-builder` / `persona-reviewer` も
キャラクター非依存で、圧縮形式で結果を返す。

## statusline

現在のキャラクターをバッジ表示できる。`<CLAUDE_CONFIG_DIR>/settings.json` に追加:

```json
"statusLine": {
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/persona-statusline.mjs\""
}
```

`${CLAUDE_PLUGIN_ROOT}` は settings.json では展開されないため、実際のパスを書く。
表示は `[ノクト]`、既定以外のレベルなら `[ノクト:無口]`。

## MCP description の圧縮（persona-shrink）

`mcp-servers/persona-shrink/` は MCP サーバの stdio proxy で、ツールカタログの
`description` を圧縮する。モデルがツール一覧を読むためのトークンが減り、
ツールの意味は変わらない。

**proxy は upstream 1つにつき1エントリ必要**なため、プラグイン側で汎用の
`.mcp.json` を用意することはできない。圧縮したいサーバごとに自分で書く:

```json
{
  "mcpServers": {
    "context7-shrunk": {
      "command": "node",
      "args": [
        "<プラグインのパス>/mcp-servers/persona-shrink/index.mjs",
        "npx", "-y", "@upstash/context7-mcp"
      ]
    }
  }
}
```

環境変数:

- `PERSONA_SHRINK_FIELDS` — 圧縮対象のフィールド名（カンマ区切り、既定 `description`）
- `PERSONA_SHRINK_DEBUG=1` — フィールドごとの圧縮量を stderr に出す

意図的に変更しないもの: upstream へのリクエスト、`tools/call` のレスポンス、
散文中の識別子・URL・パス・コードらしきトークン。

## genshijin プラグインとの併用について

**同時に有効にしない。** 両方が毎ターン別々の口調指示を注入するため、口調が安定しない。
persona には原始人がキャラクターとして同梱されているので、persona 一本に寄せられる。
同時に有効な場合は SessionStart で警告が出る。

## 構成

```text
core/            圧縮ルールと境界（キャラクター非依存、フックが読む）
characters/      標準キャラクター定義（フックが読む。モデルは読まない）
hooks/           エンジン本体
skills/          スキル定義
agents/          圧縮出力の subagent
commands/        スラッシュコマンド
mcp-servers/     persona-shrink
```

`core/` と `characters/` は**フックが読む資材**であり、モデルが読むファイルではない。
モデルが直接読むと、使っていないキャラクターとレベルまでコンテキストに載る。
