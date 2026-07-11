---
name: zenn-blog-writing
description: Zennの技術ブログ記事を執筆・編集・レビューするためのガイドラインを提供する。技術的正確性、読みやすさ、AIっぽい文章の排除を重視。Zennの記事（articles/*.md）を書く・直す・レビューするとき、または「Zenn」「技術ブログ」「記事執筆」に言及されたときに使用する。
---

# Zenn技術ブログ執筆スキル

Zennの技術記事を執筆・レビューする際の基準とワークフロー。技術的正確性、読みやすさ、AIっぽい文章の排除を重視する。

## 記事執筆のワークフロー

1. **下書き作成**: `published: false` で記事を作成
2. **執筆**: 本スキルのルールに従って記事を執筆
3. **ローカルチェック**: `npm run textlint` でチェック
4. **プレビュー**: `npm run preview` でZenn CLIプレビュー
5. **修正**: textlintの指摘を修正
6. **公開準備**: `published: true` に変更
7. **コミット**: Git commit時に自動チェックが実行される

## 自動チェックコマンド

- `npm run textlint`: 全記事をチェック
- `npm run textlint:fix`: 全記事をチェックして自動修正可能な箇所を修正

## フロントマター（必須）

```yaml
---
title: "記事のタイトル"   # 簡潔で具体的に
emoji: "😸"               # 絵文字1文字のみ
type: "tech"              # tech: 技術記事 / idea: アイデア記事
topics: ["tag1", "tag2"]  # 3-5個、小文字で統一
published: false          # false: 下書き / true: 公開
---
```

### topicsのルール

記号やスペースは使えない。以下のように変換する:

| 技術名 | topics表記 |
|--------|-----------|
| C++ | `cpp` |
| C# | `csharp` |
| .NET | `dotnet` |
| Node.js | `nodejs` |
| TypeScript | `typescript` |
| React Native | `reactnative` または `react-native` |

## 文章品質の基本ルール

### 書くとき
- 技術用語は正確に使い、初出時に説明を追加する
- コード例は動作確認済みのものを使う
- バージョン情報は明記する（例: Node.js v20.18.1）
- 1文は60文字以内を目安に、長文は分割する
- 受動態より能動態を優先（「〜されます」→「〜します」）
- 文章の末尾は必ず「。」で終わる（「：」は禁止）

### 避けるべきAIっぽい表現
- 過剰な強調（「**重要**」「**注意**」の連続使用）
- 誇張表現（「革命的」「驚異的」「完璧な」）
- 情報系プレフィックス（「重要:」「注意:」「警告:」）
- コロン後のブロック（「実行します:」→「実行方法は以下の通りです。」）
- 見出し内での太字

### コードブロック
- 必ず言語を指定する（`bash`, `javascript`, `typescript`, `python`, `json` 等）
- シェルコマンドは `bash` を使用
- 変数名・関数名は意味のあるものにする
- コメントは日本語で簡潔に

### マークダウン
- 見出しは `##` `###` `####` を論理的に階層化
- リストは箇条書き（`-`）を使用
- 技術用語はコードフォーマット（`` `text` ``）で囲む
- 外部リンクは参照した記事・ドキュメントに必ず貼る
- リンクテキストは具体的に（「こちら」ではなく「公式ドキュメント」）

## 記事本文の推奨構成

1. **導入部**: 問題提起や背景（2-3段落）
2. **本論**: 技術的説明、手順、コード例
3. **まとめ**: 要点整理と次のステップの提示

## 技術ブログとしての心構え

- **読者の視点**: 実際に試せる内容を提供する
- **正確性**: 技術情報は必ず確認してから記載する
- **継続性**: 記事は定期的に更新・メンテナンスする

## 詳細リファレンス

- 詳細な文章ルール、コードブロック規則、マークダウン規則: [WRITING-RULES.md](references/WRITING-RULES.md)
- レビュー時のチェックリスト全項目: [REVIEW-CHECKLIST.md](references/REVIEW-CHECKLIST.md)

## 参考資料

- [Zennのドキュメント](https://zenn.dev/zenn/articles/zenn-cli-guide)
- [textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing)
- [技術文書を書く心がけ](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing)
