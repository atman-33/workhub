# writing

日本語の仕事文書を読みやすく書き、直すためのプラグイン。議事録・調査レポート・社内ガイド・リサーチメモ・スライド構成案から note・ブログまで、書く工程と、既存の文章から AI 臭さを取り除く工程を1つのスキルにまとめている。

英語の執筆品質スキルなど、同種のスキルが増えた場合の受け皿でもある。プラットフォーム固有の執筆支援 (Zenn 記法など) は [`zenn`](../zenn/README.md) の担当であり、本プラグインは言語品質レイヤーに専念する。

## Install

Install at user scope so it is available from any working directory:

```
claude plugin install writing@workhub-marketplace
```

## Skills

| Skill | For |
|---|---|
| `natural-japanese` | 日本語ビジネス文書の作成・校正・推敲。既存の文章は意味を変えずに直し、ゼロからは文体憲法の下で書く |

`scripts/lint.mjs` と `scripts/diff.mjs` が同梱されている (Node のみで動く)。lint は絵文字・ダッシュ・文末コロン・比喩動詞・前置きなど機械で拾える表層を指し、diff は書き直しの前後を比べて意味が動きやすい箇所を挙げる。どちらも判断はしない。node が使えない環境では `references/manual-checklist.md` による目視で代える。

No vault or project-context dependency.

## Attribution

`natural-japanese` は [coji/natural-japanese](https://github.com/coji/natural-japanese) (MIT) の選別移植を土台に、[nanaism/yomiyasu](https://github.com/nanaism/yomiyasu) (MIT) の考え方を取り込んで再構成したもの。詳細は [NOTICE.md](NOTICE.md)。
