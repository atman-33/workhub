# writing

日本語の仕事文書を読みやすく書くためのプラグイン。議事録・調査レポート・社内ガイド・リサーチメモ・スライド構成案から note・ブログまで、AI臭さの除去と読みやすさの推敲を工程化する。

英語の執筆品質スキルなど、同種のスキルが増えた場合の受け皿でもある。プラットフォーム固有の執筆支援 (Zenn 記法など) は [`zenn`](../zenn/README.md) の担当であり、本プラグインは言語品質レイヤーに専念する。

## Install

Install at user scope so it is available from any working directory:

```
claude plugin install writing@workhub-marketplace
```

## Skills

| Skill | For |
|---|---|
| `natural-japanese` | 日本語ビジネス文書の作成・校正・推敲 |

スクリプトは同梱しない (Node ESM のみの規則に従い、Python 依存を持ち込まない)。検査は `manual-checklist.md` による目視が主経路。上流の機械検出 (lint.py 等) を使いたい場合は、上流リポジトリを参照のこと。

No vault or project-context dependency.

## Attribution

`natural-japanese` は [coji/natural-japanese](https://github.com/coji/natural-japanese) (MIT) からの選別移植。詳細は [NOTICE.md](NOTICE.md)。
