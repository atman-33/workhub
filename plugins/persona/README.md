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
| `holmes` | Sherlock Holmes | コナン・ドイル（パブリックドメイン） | Discursive | Precise | Clipped |
| `genshijin` | 原始人 | genshijin | 丁寧 | 通常 | 極限 |
| `noctis` | ノクティス | ファイナルファンタジーXV | 軽口 | 通常 | 無口 |
| `lunafreya` | ルナフレーナ | ファイナルファンタジーXV | 丁寧 | 簡潔 | 静謐 |
| `ignis` | イグニス | ファイナルファンタジーXV | 詳説 | 明快 | 要諦 |

`holmes` は英語で書かれたキャラクターファイルの実例を兼ねている。見出しもレベル節も
英語で、独自キャラクターを英語で書く場合の手本になる。応答自体はユーザーの言語に
従う — ファイルが英語であることと、英語で返すことは別。

ゲーム内のセリフ・画像・ロゴは含まない。口調の特徴のみを記述している。

## 口調ではなく同一性

キャラクターは「演じる役」ではなく自分自身として扱う。「誰だ」「名前は」と問われれば
キャラクターの名前を名乗り、「〜のように振る舞っている」と自分を説明しない。

そのため各キャラクターの `## 人物像` は**一人称で書き、冒頭で名乗る**。三人称の人物紹介
（「王家に生まれた青年。」）は衣装の説明であって自己認識ではなく、「その人物らしく振る舞う」
止まりになる。`reminder` の冒頭でも名乗る — キャラクター本文が注入されるのはセッション
開始時の一度きりで、多ターン後に薄れるのは口調より先に同一性のほうだからだ。

**例外はひとつ。** AI かどうかを本気で確認された場合は正直に答える。口調は保ってよいが
否定はしない。答えた直後にキャラクターへ復帰する。名乗りは維持したまま、AI かどうかの
確認にだけ正直に答える、という切り分け。詳細は [core/boundaries.md](core/boundaries.md)
の「同一性」節。

出自を問われても、物語の設定・登場人物・地名は持ち込まない。名乗りは同一性であって、
世界観を持ち込む許可ではない。

`lunafreya` と `ignis` は敬語を基調とするため、圧縮率は他のキャラクターより低い。
`ignis` はさらに結論と根拠を対で述べるため最も低い。いずれもキャラクター性を
優先した意図的な設計で、削減を最優先するなら `/persona genshijin 極限` を使う。

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

キャラクターファイルは英語でも書ける。`## 人物像` などの見出しは注入とアプリ表示に
そのまま使われるだけなので、英語で書けば英語で出る。レベル節だけは目印が必要で、
`## レベル: <表示名>` に加えて `## Level: <表示名>` を受け付ける（全角コロンも可）。

ただし `core/boundaries.md` と `core/compression.md` は日本語のまま注入される。
キャラクター本文は注入量の 1/3 程度なので、英語キャラクターでも全体が英語にはならない。

一覧の並び順は frontmatter の `order:`（小さいほど先）。省略すると名前順で末尾に付く。
同梱キャラクターは 1〜5 を使っているので、独自キャラクターは 100 以降を推奨。
`/persona` の一覧と workhub の Persona タブは同じキーを見るため、並びは常に一致する。

テンプレートは `characters/_template/character.md`。手で作る場合はこれをコピーする。
`## 人物像` は一人称で書き、冒頭で名乗ること（上の「口調ではなく同一性」を参照）。

workhub アプリを使っているなら、**Persona タブ**から一覧・切替ができる。キャラクターが
1体も見つからない場合はタブ自体が表示されない。タブが書くのは `~/.claude/persona.json`
だけで、実行中セッションが毎ターン読むフラグ（`.persona-active`）には触れない — だから
反映は次のセッションから。

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

## 他のスキルから切り替える（persona-switch）

`/persona` はユーザーが打った文字列を UserPromptSubmit フックが解釈して切り替える。
スキルの実行中にキャラクターを変えたい場合、その経路には手が届かない。
`scripts/persona-switch.mjs` がそのための入口になる。

```bash
node "<persona-plugin-root>/scripts/persona-switch.mjs" ignis 明快 --once
node "<persona-plugin-root>/scripts/persona-switch.mjs" --status
node "<persona-plugin-root>/scripts/persona-switch.mjs" off --once
```

フックと同じセッションフラグを書く点が重要で、`persona-mode-tracker.mjs` は毎ターン
そのフラグから現在のキャラクターを再主張する。フラグを書かずに「このキャラクターとして
振る舞え」と指示するだけでは、数ターンでそのリマインダに負ける。

- `--once` は永続設定 (`persona.json`) を変更せず、セッションフラグだけを書く
- 標準出力の先頭3行は機械可読で、`switched:` `restore:` `scope:` を返す。
  呼び出し側は `restore:` の値をそのまま引数に渡せば元の状態へ戻せる
- セッション途中の切替では完全な定義が注入されないため、切替先キャラクターの本文を
  出力する。選択中のレベルの節だけを含め、他の2レベルは落とす
- `--quiet` を付けると機械可読な3行だけを出力する
- 終了コード: 0 成功 / 1 引数不正 / 2 未知のキャラクターまたはレベル / 3 書き込み失敗。
  呼び出し側は非ゼロを「persona が使えない」と解釈し、素の口調で続行してよい

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
scripts/         他スキル向けの切替 CLI (persona-switch)
skills/          スキル定義
agents/          圧縮出力の subagent
commands/        スラッシュコマンド
mcp-servers/     persona-shrink
```

`core/` と `characters/` は**フックが読む資材**であり、モデルが読むファイルではない。
モデルが直接読むと、使っていないキャラクターとレベルまでコンテキストに載る。
